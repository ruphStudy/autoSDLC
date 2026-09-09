import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { TaskValidationConfigService } from '../task-validation.config';
import { buildSanitizedValidationEnv } from './validation-env.util';
import { redactSecrets } from './redact-secrets.util';

export interface ValidationCommandOptions {
  cwd: string;
  signal?: AbortSignal;
}

export interface ValidationCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

// The one place a validation command is ever spawned. Every command runs
// via spawn() with an argument array — never a shell string — so no
// repository-controlled script name or argument can be interpreted as a
// shell command (mirrors GitService's own invocation discipline). Commands
// are always server-resolved (ValidationPlanResolver); this executor never
// accepts a raw command string from an API request.
@Injectable()
export class ValidationCommandExecutor {
  constructor(private readonly config: TaskValidationConfigService) {}

  run(
    command: string,
    args: string[],
    options: ValidationCommandOptions,
  ): Promise<ValidationCommandResult> {
    const maxBytes = this.config.maxOutputBytes;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        timeout: this.config.commandTimeoutMs,
        env: buildSanitizedValidationEnv(),
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        const current = target === 'stdout' ? stdout : stderr;
        if (current.length >= maxBytes) {
          truncated = true;
          return;
        }
        const next = current + chunk.toString('utf8');
        if (next.length > maxBytes) {
          truncated = true;
          if (target === 'stdout') stdout = next.slice(0, maxBytes);
          else stderr = next.slice(0, maxBytes);
        } else if (target === 'stdout') {
          stdout = next;
        } else {
          stderr = next;
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk));

      const onAbort = () => {
        cancelled = true;
        child.kill('SIGTERM');
      };
      options.signal?.addEventListener('abort', onAbort);

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);

        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          if (!cancelled) timedOut = true;
        }

        resolve({
          exitCode: code,
          stdout: redactSecrets(stdout),
          stderr: redactSecrets(stderr),
          outputTruncated: truncated,
          durationMs: Date.now() - startedAt,
          timedOut,
          cancelled,
        });
      });
    });
  }
}
