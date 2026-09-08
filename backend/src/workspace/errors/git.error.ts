// Normalized domain error codes for the Git/workspace layer — the one error
// type application code should ever need to understand; callers never see
// raw child_process/exec internals.
export enum GitErrorCode {
  GIT_NOT_AVAILABLE = 'git_not_available',
  NOT_A_REPOSITORY = 'not_a_repository',
  CLONE_FAILED = 'clone_failed',
  INVALID_REMOTE = 'invalid_remote',
  BRANCH_FAILED = 'branch_failed',
  COMMIT_FAILED = 'commit_failed',
  WORKSPACE_INVALID = 'workspace_invalid',
  WORKSPACE_NOT_READY = 'workspace_not_ready',
  DIRTY_WORKTREE = 'dirty_worktree',
  COMMAND_TIMEOUT = 'command_timeout',
  COMMAND_FAILED = 'command_failed',
  PATH_VIOLATION = 'path_violation',
  AUTHENTICATION_FAILED = 'authentication_failed',
}

export interface GitErrorOptions {
  code: GitErrorCode;
  message: string;
  retryable?: boolean;
}

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly retryable: boolean;

  constructor(options: GitErrorOptions) {
    super(options.message);
    this.name = 'GitError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}
