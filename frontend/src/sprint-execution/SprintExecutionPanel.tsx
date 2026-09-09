import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { sprintExecutionApi } from '../api/sprint-execution.api';
import { jobsApi } from '../api/jobs.api';
import type { Job } from '../jobs/types';
import { ACTIVE_JOB_STATUSES } from '../jobs/types';
import type { Task } from '../sprint-planning/types';
import {
  ACTIVE_SPRINT_EXECUTION_STATUSES,
  type SprintExecution,
  type SprintExecutionEligibility,
} from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

const STATUS_TONE: Record<SprintExecution['status'], string> = {
  QUEUED: 'neutral',
  RUNNING: 'progress',
  PAUSED: 'neutral',
  COMPLETED: 'success',
  FAILED: 'danger',
  BLOCKED: 'danger',
  CANCELLED: 'neutral',
};

// Autonomous multi-Task Sprint execution (Sprint 14) — the ONLY control
// here is Start/Pause/Resume/Cancel for THIS Sprint as a whole. Every
// individual Task's own Run/Validate controls remain on its own card
// (Sprint 12/13's panels) — this component never runs, validates, or
// commits anything itself, it only orchestrates by watching Task statuses
// already visible below it.
export function SprintExecutionPanel({
  projectId,
  sprintId,
  tasks,
}: {
  projectId: string;
  sprintId: string;
  tasks: Task[];
}) {
  const [eligibility, setEligibility] = useState<SprintExecutionEligibility | null>(null);
  const [execution, setExecution] = useState<SprintExecution | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eligibilityResult, executionResult] = await Promise.allSettled([
        sprintExecutionApi.getEligibility(projectId, sprintId),
        sprintExecutionApi.getCurrentExecution(projectId, sprintId),
      ]);
      if (eligibilityResult.status === 'fulfilled') setEligibility(eligibilityResult.value);
      if (executionResult.status === 'fulfilled') {
        setExecution(executionResult.value);
        if (executionResult.value.backgroundJobId) {
          try {
            setJob(await jobsApi.getById(projectId, executionResult.value.backgroundJobId));
          } catch {
            setJob(null);
          }
        }
      } else {
        setExecution(null);
      }
    } catch {
      // Transient load failure — the next poll or manual action retries.
    }
  }, [projectId, sprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!execution || !ACTIVE_SPRINT_EXECUTION_STATUSES.includes(execution.status)) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [execution, load]);

  const handleStart = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await sprintExecutionApi.run(projectId, sprintId);
      setExecution(result.sprintExecution);
      setJob(result.job);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not start the Sprint. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handlePause = async () => {
    setWorking(true);
    setError(null);
    try {
      const updated = await sprintExecutionApi.pause(projectId, sprintId);
      setExecution(updated);
    } catch (err) {
      setError(errorMessage(err, 'Could not pause the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handleResume = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await sprintExecutionApi.resume(projectId, sprintId);
      setExecution(result.sprintExecution);
      setJob(result.job);
    } catch (err) {
      setError(errorMessage(err, 'Could not resume the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    if (
      !window.confirm(
        'Cancelling stops autonomous progression. If the active coding agent has already modified files, those changes will not be automatically reverted.',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const updated = await jobsApi.cancel(projectId, job.id);
      setJob(updated);
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const isActive = execution ? ACTIVE_SPRINT_EXECUTION_STATUSES.includes(execution.status) : false;
  const isRunning = execution?.status === 'RUNNING';
  const isPaused = execution?.status === 'PAUSED';
  const isBlocked = execution?.status === 'BLOCKED';
  const canStart = eligibility?.runnable === true && !isActive;
  const canResume = (isPaused || isBlocked) && !working;
  const canCancel = job != null && ACTIVE_JOB_STATUSES.includes(job.status);

  const currentTask = execution?.currentTaskId
    ? tasks.find((t) => t.id === execution.currentTaskId)
    : null;
  const progressPercent =
    execution && execution.totalTasks > 0
      ? Math.round((execution.passedTasks / execution.totalTasks) * 100)
      : 0;

  return (
    <div className="workspace-panel" style={{ marginBottom: 12 }}>
      <div className="job-card-header">
        <strong>Sprint Execution</strong>
        {execution && (
          <span className={`status-badge status-badge--${STATUS_TONE[execution.status]}`}>
            Attempt {execution.attempt} · {execution.status}
          </span>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="project-detail-actions" style={{ marginTop: 4 }}>
        <button type="button" onClick={handleStart} disabled={!canStart || working}>
          Start Sprint
        </button>
        {isRunning && (
          <button type="button" className="secondary" onClick={handlePause} disabled={working}>
            Pause
          </button>
        )}
        {(isPaused || isBlocked) && (
          <button type="button" onClick={handleResume} disabled={!canResume}>
            Resume
          </button>
        )}
        {canCancel && (
          <button type="button" className="secondary" onClick={handleCancel} disabled={working}>
            Cancel
          </button>
        )}
      </div>

      {isPaused && (
        <p className="approval-panel-meta">
          The current operation may finish before the Sprint pauses. No new Task will start after
          pause is requested.
        </p>
      )}

      {!canStart && !isActive && eligibility && eligibility.reasons.length > 0 && (
        <p className="approval-panel-meta">Not runnable: {eligibility.reasons.join(', ')}</p>
      )}

      {execution && (
        <>
          <p className="approval-panel-meta">
            {execution.passedTasks} / {execution.totalTasks} Tasks passed ({progressPercent}%)
          </p>
          {isActive && currentTask && (
            <p className="approval-panel-meta">
              Current Task: {currentTask.key} — {job?.progressMessage ?? 'Working...'}
            </p>
          )}
        </>
      )}

      {execution?.status === 'COMPLETED' && (
        <p className="analysis-empty-section">
          Sprint completed successfully. {execution.passedTasks} / {execution.totalTasks} Tasks
          passed. Final commit: <code>{execution.repositoryEndSha?.slice(0, 10)}</code>.
        </p>
      )}

      {execution?.status === 'FAILED' && (
        <p className="form-error">
          Sprint failed — {execution.errorMessage ?? 'a Task did not pass.'} No automatic retry.
        </p>
      )}

      {execution?.status === 'BLOCKED' && (
        <p className="form-error">
          Sprint blocked — {execution.errorMessage ?? 'no Task is currently runnable.'}
        </p>
      )}

      {execution?.status === 'CANCELLED' && (
        <p className="approval-panel-meta">
          This Sprint execution was cancelled. Any workspace changes already made were preserved,
          not reverted.
        </p>
      )}
    </div>
  );
}
