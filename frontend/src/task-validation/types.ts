export type ValidationAttemptStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';

export type ValidationRunStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';

export type ValidationCheckType =
  | 'LINT'
  | 'TYPECHECK'
  | 'UNIT_TEST'
  | 'INTEGRATION_TEST'
  | 'E2E_TEST'
  | 'BUILD'
  | 'CUSTOM';

export interface ValidationRun {
  id: string;
  type: ValidationCheckType;
  name: string;
  command: string;
  args: string[];
  workingDirectory: string | null;
  status: ValidationRunStatus;
  required: boolean;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  outputTruncated: boolean;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

// Mirrors the backend's ValidationAttemptRecord — owner-scoped only.
export interface ValidationAttempt {
  id: string;
  projectId: string;
  taskId: string;
  taskExecutionId: string;
  attempt: number;
  status: ValidationAttemptStatus;
  startedAt: string | null;
  completedAt: string | null;
  requiredPassed: number;
  requiredFailed: number;
  optionalPassed: number;
  optionalFailed: number;
  commitSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  runs: ValidationRun[];
}

export interface TaskValidationEligibility {
  runnable: boolean;
  reasons: string[];
  task: { id: string; status: string };
}

// A ValidationAttempt the UI should keep polling for — not yet terminal.
export const ACTIVE_VALIDATION_ATTEMPT_STATUSES: ValidationAttemptStatus[] = ['QUEUED', 'RUNNING'];
