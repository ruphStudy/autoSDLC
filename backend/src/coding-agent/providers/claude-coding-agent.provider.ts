import { Injectable, Logger } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { CodingAgentConfigService } from '../coding-agent.config';
import { GitService } from '../../workspace/git/git.service';
import { CodingAgentProvider } from '../contracts/coding-agent-provider.interface';
import { CodingAgentExecutionRequest } from '../contracts/coding-agent-request';
import {
  CodingAgentCommandActivity,
  CodingAgentExecutionResult,
  CodingAgentHealth,
  CodingAgentToolActivity,
} from '../contracts/coding-agent-result';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from '../errors/coding-agent.error';
import {
  ALLOWED_CODING_TOOLS,
  evaluateBashCommand,
  isPathWithinWorkspace,
} from '../policy/command-policy';
import { buildPlatformGuardrails } from '../policy/guardrails';
import { buildSanitizedClaudeEnv } from './claude-env.util';
import { detectChangedFiles } from './git-change-detection.util';

const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit']);

// Maps the SDK's own error taxonomy to ours — never let a raw Claude Agent
// SDK error subtype/message leak into business code (item 43/66).
const ASSISTANT_ERROR_MAP: Record<string, CodingAgentErrorCode> = {
  authentication_failed: CodingAgentErrorCode.AUTHENTICATION_ERROR,
  oauth_org_not_allowed: CodingAgentErrorCode.AUTHENTICATION_ERROR,
  account_on_hold: CodingAgentErrorCode.AUTHENTICATION_ERROR,
  billing_error: CodingAgentErrorCode.AUTHENTICATION_ERROR,
  rate_limit: CodingAgentErrorCode.RATE_LIMITED,
  overloaded: CodingAgentErrorCode.PROVIDER_UNAVAILABLE,
  invalid_request: CodingAgentErrorCode.INVALID_REQUEST,
  model_not_found: CodingAgentErrorCode.CONFIGURATION_ERROR,
  server_error: CodingAgentErrorCode.PROVIDER_UNAVAILABLE,
  max_output_tokens: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
  unknown: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
};

const RESULT_ERROR_SUBTYPE_MAP: Record<string, CodingAgentErrorCode> = {
  error_max_turns: CodingAgentErrorCode.MAX_TURNS_EXCEEDED,
  error_max_budget_usd: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
  error_max_structured_output_retries:
    CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
  error_during_execution: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
};

interface RunOutcome {
  toolActivities: CodingAgentToolActivity[];
  commandActivities: CodingAgentCommandActivity[];
  finalResult: SDKResultMessage | null;
  // The most specific error the SDK reported on any assistant message
  // during the run (e.g. 'authentication_failed') — more actionable than
  // the final result's generic 'error_during_execution' subtype when both
  // are present, so executeTask prefers this one.
  lastAssistantError: string | null;
  timedOut: boolean;
  cancelled: boolean;
}

// The one place the Claude Agent SDK is ever imported. No SDK type crosses
// out of this file except through the provider-neutral CodingAgentProvider
// contract — see coding-agent-provider.interface.ts.
@Injectable()
export class ClaudeCodingAgentProvider implements CodingAgentProvider {
  private readonly logger = new Logger(ClaudeCodingAgentProvider.name);

  constructor(
    private readonly config: CodingAgentConfigService,
    private readonly git: GitService,
  ) {}

  async healthCheck(): Promise<CodingAgentHealth> {
    const configured = Boolean(
      this.config.claude.apiKey || this.config.claude.oauthToken,
    );
    if (!configured) {
      return {
        provider: 'claude',
        configured: false,
        errorCode: CodingAgentErrorCode.CONFIGURATION_ERROR,
      };
    }

    // Minimal, cheap, tool-free request (item 48) — no file/command access,
    // a single turn, bounded timeout. Never runs a real coding task.
    try {
      const outcome = await this.runQuery({
        prompt: 'Reply with exactly one word: ok',
        cwd: process.cwd(),
        tools: [],
        maxTurns: 1,
        timeoutMs: 15000,
        signal: undefined,
      });
      const ok =
        outcome.finalResult?.subtype === 'success' && !outcome.timedOut;
      return {
        provider: 'claude',
        configured: true,
        reachable: ok,
        model: this.config.claude.model,
        errorCode: ok ? undefined : CodingAgentErrorCode.PROVIDER_UNAVAILABLE,
      };
    } catch (error) {
      const normalized = this.normalizeThrown(error);
      return {
        provider: 'claude',
        configured: true,
        reachable: false,
        model: this.config.claude.model,
        errorCode: normalized.code,
      };
    }
  }

  async executeTask(
    request: CodingAgentExecutionRequest,
  ): Promise<CodingAgentExecutionResult> {
    if (!request.instruction.trim()) {
      throw new CodingAgentError({
        code: CodingAgentErrorCode.INVALID_REQUEST,
        message: 'instruction must not be empty.',
      });
    }
    if (!request.workspacePath) {
      throw new CodingAgentError({
        code: CodingAgentErrorCode.INVALID_REQUEST,
        message: 'workspacePath is required.',
      });
    }

    const maxTurns = Math.min(
      request.constraints?.maxTurns ?? this.config.claude.maxTurns,
      this.config.claude.maxTurns,
    );
    const timeoutMs = Math.min(
      request.constraints?.timeoutMs ?? this.config.claude.executionTimeoutMs,
      this.config.claude.executionTimeoutMs,
    );

    const startedAt = Date.now();
    let outcome: RunOutcome;
    try {
      outcome = await this.runQuery({
        prompt: buildUserPrompt(request),
        cwd: request.workspacePath,
        tools: [...ALLOWED_CODING_TOOLS],
        maxTurns,
        timeoutMs,
        signal: request.signal,
      });
    } catch (error) {
      // Nothing ran at all — no workspace interaction was possible, so this
      // is the one case allowed to reject rather than return a result.
      throw this.normalizeThrown(error);
    }

    const durationMs = Date.now() - startedAt;
    const changedFiles = await detectChangedFiles(
      this.git,
      request.workspacePath,
    );

    if (outcome.cancelled) {
      return {
        status: 'CANCELLED',
        summary: 'Execution was cancelled before completion.',
        errorCode: CodingAgentErrorCode.CANCELLED,
        errorMessage: 'Execution was cancelled.',
        changedFiles,
        toolActivities: outcome.toolActivities,
        commandActivities: outcome.commandActivities,
        metadata: {
          provider: 'claude',
          model: this.config.claude.model,
          durationMs,
        },
      };
    }

    if (outcome.timedOut) {
      return {
        status: 'FAILED',
        summary: `Execution exceeded the ${timeoutMs}ms timeout.`,
        errorCode: CodingAgentErrorCode.TIMEOUT,
        errorMessage: `Execution exceeded the configured timeout of ${timeoutMs}ms.`,
        changedFiles,
        toolActivities: outcome.toolActivities,
        commandActivities: outcome.commandActivities,
        metadata: {
          provider: 'claude',
          model: this.config.claude.model,
          durationMs,
        },
      };
    }

    const final = outcome.finalResult;
    if (!final || final.subtype !== 'success') {
      const subtype = final?.subtype;
      // Prefer the more specific assistant-level error (e.g.
      // 'authentication_failed') over the result's generic subtype
      // ('error_during_execution') when both are present.
      const code =
        (outcome.lastAssistantError &&
          ASSISTANT_ERROR_MAP[outcome.lastAssistantError]) ??
        (subtype && RESULT_ERROR_SUBTYPE_MAP[subtype]) ??
        CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR;
      return {
        status: 'FAILED',
        summary: subtype
          ? `Execution ended without success (${subtype}).`
          : 'Execution ended without a result.',
        errorCode: code,
        errorMessage: outcome.lastAssistantError
          ? `Claude execution ended with: ${outcome.lastAssistantError}.`
          : subtype
            ? `Claude execution ended with: ${subtype}.`
            : 'Claude execution produced no result message.',
        changedFiles,
        toolActivities: outcome.toolActivities,
        commandActivities: outcome.commandActivities,
        usage: final ? mapUsage(final) : undefined,
        metadata: {
          provider: 'claude',
          model: this.config.claude.model,
          durationMs,
          turns: final?.num_turns,
          providerRequestId: final?.session_id,
        },
      };
    }

    return {
      status: 'SUCCEEDED',
      summary: truncate(final.result, this.config.claude.maxOutputBytes),
      changedFiles,
      toolActivities: outcome.toolActivities,
      commandActivities: outcome.commandActivities,
      usage: mapUsage(final),
      metadata: {
        provider: 'claude',
        model: this.config.claude.model,
        durationMs,
        turns: final.num_turns,
        providerRequestId: final.session_id,
      },
    };
  }

  // ---- internals -----------------------------------------------------

  private async runQuery(params: {
    prompt: string;
    cwd: string;
    tools: string[];
    maxTurns: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<RunOutcome> {
    const abortController = new AbortController();
    let timedOut = false;
    let cancelled = false;

    const onExternalAbort = () => {
      cancelled = true;
      abortController.abort();
    };
    if (params.signal) {
      if (params.signal.aborted) onExternalAbort();
      else params.signal.addEventListener('abort', onExternalAbort);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, params.timeoutMs);

    const toolActivities: CodingAgentToolActivity[] = [];
    const commandActivities: CodingAgentCommandActivity[] = [];
    // Keyed by Bash tool_use id so the matching tool_result can attach
    // exit-code/duration information to the same command activity entry.
    const pendingBashById = new Map<string, CodingAgentCommandActivity>();

    const canUseTool: CanUseTool = async (toolName, input) => {
      return this.evaluateToolUse(toolName, input, params.cwd);
    };

    const env = buildSanitizedClaudeEnv({
      apiKey: this.config.claude.apiKey,
      oauthToken: this.config.claude.oauthToken,
    });

    const options: Options = {
      cwd: params.cwd,
      env,
      model: this.config.claude.model,
      maxTurns: params.maxTurns,
      abortController,
      tools: params.tools,
      permissionMode: 'default',
      canUseTool,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: buildPlatformGuardrails(),
      },
      includePartialMessages: false,
      persistSession: false,
    };

    let finalResult: SDKResultMessage | null = null;
    let lastAssistantError: string | null = null;
    try {
      for await (const message of query({ prompt: params.prompt, options })) {
        this.captureActivity(
          message,
          toolActivities,
          pendingBashById,
          commandActivities,
        );
        if (message.type === 'assistant' && message.error) {
          lastAssistantError = message.error;
        }
        if (message.type === 'result') {
          finalResult = message;
        }
      }
    } finally {
      clearTimeout(timer);
      if (params.signal) {
        params.signal.removeEventListener('abort', onExternalAbort);
      }
    }

    return {
      toolActivities,
      commandActivities,
      finalResult,
      lastAssistantError,
      timedOut,
      cancelled,
    };
  }

  private async evaluateToolUse(
    toolName: string,
    input: Record<string, unknown>,
    workspacePath: string,
  ): Promise<PermissionResult> {
    if (toolName === 'Bash' && typeof input.command === 'string') {
      const decision = evaluateBashCommand(input.command);
      if (!decision.allowed) {
        return {
          behavior: 'deny',
          message: decision.reason ?? 'Command denied by platform policy.',
        };
      }
      return { behavior: 'allow' };
    }

    if (FILE_PATH_TOOLS.has(toolName) && typeof input.file_path === 'string') {
      if (!isPathWithinWorkspace(input.file_path, workspacePath)) {
        return {
          behavior: 'deny',
          message:
            'File access outside the project workspace is not permitted.',
        };
      }
      return { behavior: 'allow' };
    }

    return { behavior: 'allow' };
  }

  private captureActivity(
    message: SDKMessage,
    toolActivities: CodingAgentToolActivity[],
    pendingBashById: Map<string, CodingAgentCommandActivity>,
    commandActivities: CodingAgentCommandActivity[],
  ): void {
    if (message.type === 'assistant') {
      const content = (message.message as { content?: unknown[] }).content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as {
          type?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
        if (b.type !== 'tool_use') continue;
        toolActivities.push({
          type: 'tool_use',
          name: b.name ?? 'unknown',
          startedAt: new Date().toISOString(),
          summary: summarizeToolInput(b.name, b.input),
        });
        if (b.name === 'Bash' && b.id && typeof b.input?.command === 'string') {
          pendingBashById.set(b.id, {
            command: truncate(b.input.command, 500),
          });
        }
      }
      return;
    }

    if (message.type === 'user') {
      const content = (message.message as { content?: unknown[] }).content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const b = block as {
          type?: string;
          tool_use_id?: string;
          is_error?: boolean;
          content?: unknown;
        };
        if (b.type !== 'tool_result' || !b.tool_use_id) continue;
        const pending = pendingBashById.get(b.tool_use_id);
        if (pending) {
          pending.success = !b.is_error;
          commandActivities.push(pending);
          pendingBashById.delete(b.tool_use_id);
        }
      }
    }
  }

  private normalizeThrown(error: unknown): CodingAgentError {
    if (error instanceof CodingAgentError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes('enoent') || lower.includes('not found')) {
      return new CodingAgentError({
        code: CodingAgentErrorCode.PROVIDER_UNAVAILABLE,
        message: 'The Claude Code executable could not be launched.',
        cause: error,
      });
    }
    if (lower.includes('auth')) {
      return new CodingAgentError({
        code: CodingAgentErrorCode.AUTHENTICATION_ERROR,
        message: 'Claude authentication failed.',
        cause: error,
      });
    }
    return new CodingAgentError({
      code: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
      message: 'The coding agent provider failed unexpectedly.',
      cause: error,
    });
  }
}

function buildUserPrompt(request: CodingAgentExecutionRequest): string {
  const parts = [request.instruction.trim()];
  const context = request.context;
  if (context?.projectSummary) {
    parts.push(`\nProject summary:\n${context.projectSummary}`);
  }
  if (context?.architectureSummary) {
    parts.push(`\nArchitecture summary:\n${context.architectureSummary}`);
  }
  if (context?.acceptanceCriteria?.length) {
    parts.push(
      `\nAcceptance criteria:\n${context.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
    );
  }
  return parts.join('\n');
}

function summarizeToolInput(
  name: string | undefined,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return name ?? 'unknown tool call';
  if (typeof input.file_path === 'string') return `${name}: ${input.file_path}`;
  if (typeof input.command === 'string')
    return `${name}: ${truncate(input.command, 200)}`;
  if (typeof input.pattern === 'string') return `${name}: ${input.pattern}`;
  return name ?? 'unknown tool call';
}

function mapUsage(
  result: SDKResultMessage,
): CodingAgentExecutionResult['usage'] {
  const usage = result.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined;
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  };
}

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf8') + '\n…(truncated)';
}
