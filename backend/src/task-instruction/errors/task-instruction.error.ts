// Normalized domain error codes for Task instruction generation — mirrors
// the GitError / CodingAgentError pattern used elsewhere in this codebase.
export enum TaskInstructionErrorCode {
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  // The Task belongs to a SprintPlan version that is no longer current —
  // its lineage must drive context, so an instruction can't be generated
  // against a superseded plan (see item 9).
  TASK_NOT_IN_CURRENT_PLAN = 'TASK_NOT_IN_CURRENT_PLAN',
  PLAN_NOT_APPROVED = 'PLAN_NOT_APPROVED',
  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',
  CONTEXT_BUILD_FAILED = 'CONTEXT_BUILD_FAILED',
  INVALID_INSTRUCTION_RESPONSE = 'INVALID_INSTRUCTION_RESPONSE',
  // The repository HEAD moved between context-build time and the moment the
  // generated instruction would be persisted (item 70) — the caller should
  // simply retry generation against the new state.
  REPOSITORY_STATE_CHANGED = 'REPOSITORY_STATE_CHANGED',
  GENERATION_IN_PROGRESS = 'GENERATION_IN_PROGRESS',
}

export interface TaskInstructionErrorOptions {
  code: TaskInstructionErrorCode;
  message: string;
  cause?: unknown;
}

export class TaskInstructionError extends Error {
  readonly code: TaskInstructionErrorCode;
  readonly cause?: unknown;

  constructor(options: TaskInstructionErrorOptions) {
    super(options.message);
    this.name = 'TaskInstructionError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
