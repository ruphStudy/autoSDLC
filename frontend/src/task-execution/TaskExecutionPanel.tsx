import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { taskExecutionApi } from '../api/task-execution.api';
import { jobsApi } from '../api/jobs.api';
import type { Job } from '../jobs/types';
import { ACTIVE_JOB_STATUSES } from '../jobs/types';
import { ACTIVE_TASK_EXECUTION_STATUSES, type TaskEligibility, type TaskExecution } from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_TONE: Record<TaskExecution['status'], string> = {
  QUEUED: 'neutral',
  RUNNING: 'progress',
  AGENT_COMPLETED: 'progress',
  READY_FOR_VALIDATION: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

// Autonomous single-Task execution (Sprint 12) — deliberately the *only*
// execution control on a Task: no Validate/Commit button (Sprint 13 owns
// deterministic validation) and no "Run Sprint"/"Run All Tasks" automation
// (Sprint 14). A successful run only ever reaches READY_FOR_VALIDATION /
// Task REVIEWING, never PASSED.
export function TaskExecutionPanel({
  projectId,
  taskId,
  taskStatus,
}: {
  projectId: string;
  taskId: string;
  taskStatus: string;
}) {
  const [eligibility, setEligibility] = useState<TaskEligibility | null>(null);
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eligibilityResult, executionResult] = await Promise.allSettled([
        taskExecutionApi.getEligibility(projectId, taskId),
        taskExecutionApi.getCurrentExecution(projectId, taskId),
      ]);
      if (eligibilityResult.status === 'fulfilled') {
        setEligibility(eligibilityResult.value);
      }
      if (executionResult.status === 'fulfilled') {
        setExecution(executionResult.value);
      } else {
        setExecution(null);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the background Job while an execution is in flight — reuses
  // Sprint 8's existing job endpoints rather than a bespoke status stream.
  useEffect(() => {
    if (!execution || !ACTIVE_TASK_EXECUTION_STATUSES.includes(execution.status)) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const [freshEligibility, freshExecution] = await Promise.all([
          taskExecutionApi.getEligibility(projectId, taskId),
          taskExecutionApi.getCurrentExecution(projectId, taskId),
        ]);
        if (cancelled) return;
        setEligibility(freshEligibility);
        setExecution(freshExecution);
        if (freshExecution.agentJobId) {
          // The background Job id is only known via the run() response, so
          // once we lose track of it (e.g. after a page reload) job-level
          // progress simply stays unavailable — the TaskExecution status
          // itself is still authoritative.
        }
      } catch {
        // Transient poll failure — try again on the next tick.
      }
    };
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [execution, projectId, taskId]);

  // Also poll the specific background Job once we know its id (from the
  // run() response), so progress/cancel-ability reflect live state.
  useEffect(() => {
    if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) return;
    const interval = setInterval(async () => {
      try {
        const fresh = await jobsApi.getById(projectId, job.id);
        setJob(fresh);
      } catch {
        // Transient poll failure — try again on the next tick.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [job, projectId]);

  const handleRun = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await taskExecutionApi.run(projectId, taskId);
      setExecution(result.taskExecution);
      setJob(result.job);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not run this Task. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    if (
      !window.confirm(
        'Cancel this run? Any files the coding agent has already changed will NOT be reverted.',
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
      setError(errorMessage(err, 'Could not cancel this run.'));
    } finally {
      setWorking(false);
    }
  };

  const isActive = execution ? ACTIVE_TASK_EXECUTION_STATUSES.includes(execution.status) : false;
  const canRun = eligibility?.runnable === true && !isActive;
  const canCancel = job != null && ACTIVE_JOB_STATUSES.includes(job.status);

  return (
    <div className="workspace-panel" style={{ marginTop: 8 }}>
      <div className="job-card-header">
        <strong>Execution</strong>
        {execution && (
          <span className={`status-badge status-badge--${STATUS_TONE[execution.status]}`}>
            Attempt {execution.attempt} · {execution.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {loading && !eligibility && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      <div className="project-detail-actions" style={{ marginTop: 4 }}>
        <button type="button" onClick={handleRun} disabled={!canRun || working}>
          Run Task
        </button>
        {canCancel && (
          <button type="button" className="secondary" onClick={handleCancel} disabled={working}>
            Cancel
          </button>
        )}
      </div>

      {!canRun && eligibility && !isActive && eligibility.reasons.length > 0 && (
        <p className="approval-panel-meta">
          Not runnable: {eligibility.reasons.join(', ')}
        </p>
      )}

      {execution && execution.status === 'READY_FOR_VALIDATION' && (
        <div>
          <p className="analysis-empty-section">
            Implementation completed. Validation required before this Task can pass — Task is now
            in <strong>{taskStatus}</strong>.
          </p>
          {execution.changedFiles.length > 0 && (
            <>
              <p className="approval-panel-meta">Changed files:</p>
              <ul className="analysis-card-list">
                {execution.changedFiles.map((f, i) => (
                  <li key={i}>
                    {f.changeType}: {f.path}
                  </li>
                ))}
              </ul>
            </>
          )}
          {execution.changedFiles.length === 0 && (
            <p className="approval-panel-meta">The coding agent made no file changes.</p>
          )}
          <p className="approval-panel-meta">
            Duration: {execution.durationMs != null ? `${execution.durationMs}ms` : '—'} · Completed{' '}
            {formatDate(execution.completedAt)}
          </p>
        </div>
      )}

      {execution && execution.status === 'FAILED' && (
        <div>
          <p className="form-error">
            {execution.errorMessage ?? 'The coding agent execution failed.'}
          </p>
          {execution.changedFiles.length > 0 && (
            <p className="form-error">
              The workspace still has {execution.changedFiles.length} changed file
              {execution.changedFiles.length === 1 ? '' : 's'} left in place as evidence — it was
              not reset. This will block further execution until resolved.
            </p>
          )}
          <p className="approval-panel-meta">This Task will not be retried automatically.</p>
        </div>
      )}

      {execution && execution.status === 'CANCELLED' && (
        <p className="approval-panel-meta">
          This run was cancelled. Cancelling does not revert any workspace changes the coding
          agent had already made.
        </p>
      )}

      {isActive && (
        <p className="approval-panel-meta">
          {job?.progressMessage ?? 'Running…'}
          {job?.progress != null ? ` (${job.progress}%)` : ''}
        </p>
      )}
    </div>
  );
}
