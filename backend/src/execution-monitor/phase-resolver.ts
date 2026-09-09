import {
  AgentJobStatus,
  SprintExecutionStatus,
  TaskExecutionStatus,
  ValidationAttemptStatus,
  ValidationRunStatus,
} from '@prisma/client';
import { ExecutionPhase } from './types/execution-monitor.types';

export interface PhaseResolverInput {
  // Null means "this Sprint has never been run" — resolves to IDLE.
  sprintExecutionStatus: SprintExecutionStatus | null;
  taskExecution?: {
    status: TaskExecutionStatus;
    agentJobId: string | null;
  } | null;
  agentJob?: { status: AgentJobStatus } | null;
  validationAttempt?: {
    status: ValidationAttemptStatus;
    runs: { status: ValidationRunStatus }[];
  } | null;
}

const RUN_TERMINAL_STATUSES: ValidationRunStatus[] = [
  'PASSED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
];

// Pure, deterministic, independently testable (items 56/57/113/165-169).
// Never calls AI, the database, or the filesystem. Precedence, highest
// first:
//   1. No SprintExecution ever created -> IDLE.
//   2. A terminal or PAUSED SprintExecution status ALWAYS wins over
//      whatever subordinate Task/Agent/Validation state happens to still
//      be sitting in the database (items 168/169) — that data is stale by
//      definition once the Sprint itself has stopped.
//   3. QUEUED -> QUEUED (Sprint job not yet picked up by a worker).
//   4. RUNNING -> drill into Task/TaskExecution/AgentJob/ValidationAttempt
//      to find the fine-grained phase.
export function resolveExecutionPhase(
  input: PhaseResolverInput,
): ExecutionPhase {
  const { sprintExecutionStatus } = input;

  if (sprintExecutionStatus === null) return 'IDLE';

  switch (sprintExecutionStatus) {
    case 'PAUSED':
      return 'PAUSED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'FAILED':
      return 'FAILED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'QUEUED':
      return 'QUEUED';
    case 'RUNNING':
      return resolveRunningPhase(input);
    default:
      return 'IDLE';
  }
}

function resolveRunningPhase(input: PhaseResolverInput): ExecutionPhase {
  const { taskExecution, agentJob, validationAttempt } = input;

  // Sprint is RUNNING but no Task has been claimed yet (loop just started,
  // or between Tasks) -> about to prepare the next one.
  if (!taskExecution) return 'PREPARING';

  switch (taskExecution.status) {
    case 'QUEUED':
      return 'PREPARING';
    case 'RUNNING':
      // No AgentJob created yet -> still generating/fetching the fresh
      // Task instruction (Sprint 11), before the coding agent is invoked.
      if (!taskExecution.agentJobId || !agentJob) {
        return 'GENERATING_INSTRUCTION';
      }
      return resolveAgentPhase(agentJob.status);
    case 'AGENT_COMPLETED':
      // The coding agent has finished; the orchestrator is inspecting
      // real `git status`/diff before deciding the Task's outcome.
      return 'CAPTURING_CHANGES';
    case 'READY_FOR_VALIDATION':
      return resolveValidationPhase(validationAttempt);
    case 'FAILED':
    case 'CANCELLED':
      // Transient: the Sprint loop is about to re-read its own status and
      // stop (FAILED) on its next iteration — SprintExecution itself
      // hasn't flipped yet in this exact read. Treat as capturing/settling
      // rather than fabricating a premature terminal phase.
      return 'CAPTURING_CHANGES';
    default:
      return 'PREPARING';
  }
}

function resolveAgentPhase(status: AgentJobStatus): ExecutionPhase {
  if (status === 'QUEUED' || status === 'RUNNING') return 'CODING';
  // SUCCEEDED/FAILED/CANCELLED — the agent just finished; TaskExecution
  // hasn't been flipped to AGENT_COMPLETED in this exact read yet.
  return 'CAPTURING_CHANGES';
}

function resolveValidationPhase(
  validationAttempt: PhaseResolverInput['validationAttempt'],
): ExecutionPhase {
  if (!validationAttempt) return 'PREPARING';

  switch (validationAttempt.status) {
    case 'QUEUED':
      return 'PREPARING';
    case 'RUNNING': {
      const allRunsTerminal = validationAttempt.runs.every((run) =>
        RUN_TERMINAL_STATUSES.includes(run.status),
      );
      // Every check has finished but the attempt itself hasn't been
      // marked PASSED/FAILED yet -> staging + committing the change set.
      return allRunsTerminal ? 'COMMITTING' : 'VALIDATING';
    }
    case 'PASSED':
    case 'FAILED':
    case 'CANCELLED':
      // Transient: the orchestrator is about to move to the next Task or
      // stop the Sprint on its next loop iteration.
      return 'COMMITTING';
    default:
      return 'VALIDATING';
  }
}
