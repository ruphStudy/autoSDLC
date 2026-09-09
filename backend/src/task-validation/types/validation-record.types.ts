import {
  ValidationAttemptStatus,
  ValidationCheckType,
  ValidationRunStatus,
} from '@prisma/client';
import { TaskValidationErrorCode } from '../errors/task-validation.error';
import { JobRecord } from '../../jobs/types/job.types';

// Public-facing shape of a ValidationRun — deliberately excludes nothing
// sensitive (stdout/stderr are already bounded + secret-redacted before
// persistence), but never exposes an absolute filesystem path.
export interface ValidationRunRecord {
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
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}

export interface ValidationAttemptRecord {
  id: string;
  projectId: string;
  taskId: string;
  taskExecutionId: string;
  attempt: number;
  status: ValidationAttemptStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  requiredPassed: number;
  requiredFailed: number;
  optionalPassed: number;
  optionalFailed: number;
  commitSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  runs: ValidationRunRecord[];
}

export interface TaskValidationEligibilityResult {
  runnable: boolean;
  reasons: TaskValidationErrorCode[];
  task: { id: string; status: string };
}

export interface ValidateTaskResult {
  validationAttempt: ValidationAttemptRecord;
  job: JobRecord;
}
