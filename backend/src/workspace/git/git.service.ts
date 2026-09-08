import { spawn } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { WorkspaceConfigService } from '../workspace.config';
import { GitError, GitErrorCode } from '../errors/git.error';
import { redactGitUrl } from './git-url.util';
import {
  ChangedFile,
  ChangedFileStatus,
  GitCommandResult,
  GitDiffResult,
  GitStatusResult,
  RemoteInfo,
} from './git.types';

function parsePorcelainV1(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const lines = output.split('\n').filter((line) => line.length > 0);

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);

    if (x === '?' && y === '?') {
      files.push({ path: rest, status: 'UNTRACKED', staged: false });
      continue;
    }

    let filePath = rest;
    let fromPath: string | undefined;
    if (rest.includes(' -> ')) {
      const [from, to] = rest.split(' -> ');
      fromPath = from;
      filePath = to;
    }

    if (x !== ' ' && x !== '?') {
      files.push({
        path: filePath,
        status: statusFromCode(x),
        staged: true,
        ...(fromPath ? { fromPath } : {}),
      });
    }
    if (y !== ' ' && y !== '?') {
      files.push({
        path: filePath,
        status: statusFromCode(y),
        staged: false,
        ...(fromPath ? { fromPath } : {}),
      });
    }
  }
  return files;
}

function statusFromCode(code: string): ChangedFileStatus {
  switch (code) {
    case 'A':
      return 'ADDED';
    case 'D':
      return 'DELETED';
    case 'R':
      return 'RENAMED';
    case 'M':
    default:
      return 'MODIFIED';
  }
}

// The one place Git is ever invoked from — every command goes through
// spawn() with an argument array (never a shell string), so there is no
// path by which a repository URL, branch name, or commit message can be
// interpreted as a shell command. No method here accepts a raw command
// string; each capability is its own explicit, narrow function.
@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(private readonly config: WorkspaceConfigService) {}

  async checkAvailability(): Promise<boolean> {
    try {
      const result = await this.run(['--version'], { timeoutMs: 5000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async init(cwd: string, defaultBranch: string): Promise<void> {
    const result = await this.run(['init', '-b', defaultBranch], { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.COMMAND_FAILED,
        message: 'Failed to initialize repository.',
      });
    }
  }

  async configureIdentity(
    cwd: string,
    name: string,
    email: string,
  ): Promise<void> {
    // Workspace-local only — `git config` here has no `--global`, so this
    // never touches the machine's global Git configuration.
    const nameResult = await this.run(['config', 'user.name', name], { cwd });
    const emailResult = await this.run(['config', 'user.email', email], {
      cwd,
    });
    if (nameResult.exitCode !== 0 || emailResult.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.COMMAND_FAILED,
        message: 'Failed to configure Git identity.',
      });
    }
  }

  async clone(url: string, targetDir: string): Promise<void> {
    const result = await this.run(['clone', '--', url, targetDir], {
      timeoutMs: this.config.cloneTimeoutMs,
      redactUrls: [url],
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toLowerCase();
      if (
        stderr.includes('authentication') ||
        stderr.includes('could not read username') ||
        stderr.includes('permission denied') ||
        stderr.includes('access denied')
      ) {
        throw new GitError({
          code: GitErrorCode.AUTHENTICATION_FAILED,
          message:
            'This repository requires authentication, which is not supported yet. Only public repositories can be cloned.',
        });
      }
      throw new GitError({
        code: GitErrorCode.CLONE_FAILED,
        message:
          'Failed to clone repository. Verify the URL is correct and publicly accessible.',
      });
    }
  }

  async isInsideWorkTree(cwd: string): Promise<boolean> {
    try {
      const result = await this.run(['rev-parse', '--is-inside-work-tree'], {
        cwd,
      });
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async getCurrentBranch(cwd: string): Promise<string | null> {
    const result = await this.run(['branch', '--show-current'], { cwd });
    if (result.exitCode !== 0) return null;
    const branch = result.stdout.trim();
    return branch.length > 0 ? branch : null;
  }

  async createBranch(cwd: string, branchName: string): Promise<void> {
    const result = await this.run(['checkout', '-b', branchName], { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.BRANCH_FAILED,
        message: `Failed to create branch "${branchName}".`,
      });
    }
  }

  async switchBranch(cwd: string, branchName: string): Promise<void> {
    const result = await this.run(['checkout', branchName], { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.BRANCH_FAILED,
        message: `Failed to switch to branch "${branchName}".`,
      });
    }
  }

  async getStatus(cwd: string): Promise<GitStatusResult> {
    const result = await this.run(['status', '--porcelain=v1'], { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.NOT_A_REPOSITORY,
        message: 'Unable to read Git status.',
      });
    }
    const files = parsePorcelainV1(result.stdout);
    return { clean: files.length === 0, files };
  }

  async getDiff(
    cwd: string,
    options: { staged?: boolean } = {},
  ): Promise<GitDiffResult> {
    const args = ['diff', '--no-color'];
    if (options.staged) args.push('--staged');
    const result = await this.run(args, { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.COMMAND_FAILED,
        message: 'Unable to compute diff.',
      });
    }
    return {
      diff: result.stdout,
      truncated: result.truncated,
      sizeBytes: Buffer.byteLength(result.stdout, 'utf8'),
    };
  }

  // Paths must already be validated repository-relative paths (see
  // WorkspacePathService) — the `--` separator additionally guards against
  // a path that happens to look like a flag being misinterpreted by git.
  async stageFiles(cwd: string, relativePaths: string[]): Promise<void> {
    if (relativePaths.length === 0) return;
    const result = await this.run(['add', '--', ...relativePaths], { cwd });
    if (result.exitCode !== 0) {
      throw new GitError({
        code: GitErrorCode.COMMAND_FAILED,
        message: 'Failed to stage files.',
      });
    }
  }

  async commit(
    cwd: string,
    message: string,
    options: { allowEmpty?: boolean } = {},
  ): Promise<string> {
    const args = ['commit', '-m', message];
    if (options.allowEmpty) args.push('--allow-empty');
    const result = await this.run(args, { cwd });
    if (result.exitCode !== 0) {
      if (/nothing to commit/i.test(result.stdout + result.stderr)) {
        throw new GitError({
          code: GitErrorCode.COMMIT_FAILED,
          message: 'No staged changes to commit.',
        });
      }
      throw new GitError({
        code: GitErrorCode.COMMIT_FAILED,
        message: 'Failed to create commit.',
      });
    }
    const sha = await this.getHeadCommitSha(cwd);
    if (!sha) {
      throw new GitError({
        code: GitErrorCode.COMMIT_FAILED,
        message:
          'Commit succeeded but the resulting SHA could not be resolved.',
      });
    }
    return sha;
  }

  async getHeadCommitSha(cwd: string): Promise<string | null> {
    const result = await this.run(['rev-parse', 'HEAD'], { cwd });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  async getRemoteInfo(
    cwd: string,
    remoteName = 'origin',
  ): Promise<RemoteInfo | null> {
    const result = await this.run(['remote', 'get-url', remoteName], { cwd });
    if (result.exitCode !== 0) return null;
    const rawUrl = result.stdout.trim();
    return { name: remoteName, url: redactGitUrl(rawUrl) };
  }

  // ---- command execution -------------------------------------------------

  private run(
    args: string[],
    options: { cwd?: string; timeoutMs?: number; redactUrls?: string[] } = {},
  ): Promise<GitCommandResult> {
    const timeoutMs = options.timeoutMs ?? this.config.commandTimeoutMs;
    const maxBytes = this.config.maxOutputBytes;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: options.cwd,
        timeout: timeoutMs,
        // Never let Git block waiting for interactive credential input —
        // a hung prompt would otherwise defeat the timeout's intent.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;

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

      child.on('error', (error) => {
        reject(
          new GitError({
            code: GitErrorCode.GIT_NOT_AVAILABLE,
            message: `Failed to run git: ${error.message}`,
          }),
        );
      });

      child.on('close', (code, signal) => {
        const durationMs = Date.now() - startedAt;
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          timedOut = true;
        }

        const redact = (text: string): string => {
          let sanitized = text;
          for (const url of options.redactUrls ?? []) {
            const redacted = redactGitUrl(url);
            if (redacted !== url)
              sanitized = sanitized.split(url).join(redacted);
          }
          return sanitized;
        };

        if (timedOut) {
          reject(
            new GitError({
              code: GitErrorCode.COMMAND_TIMEOUT,
              message: `git ${args[0] ?? ''} timed out after ${timeoutMs}ms`,
              retryable: true,
            }),
          );
          return;
        }

        resolve({
          command: 'git',
          args,
          exitCode: code,
          stdout: redact(stdout),
          stderr: redact(stderr),
          durationMs,
          truncated,
        });
      });
    });
  }
}
