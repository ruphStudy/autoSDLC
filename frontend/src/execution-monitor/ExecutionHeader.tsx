import { useState } from 'react';
import axios from 'axios';
import { sprintExecutionApi } from '../api/sprint-execution.api';
import { jobsApi } from '../api/jobs.api';
import { PhaseBadge } from './PhaseBadge';
import { formatElapsedSince } from './format';
import type { ProjectExecutionOverview } from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

// The only place on this page that calls a mutating endpoint — and even
// here, every call goes straight to Sprint 14's existing
// SprintExecutionService APIs (item 64/121/122). This component never
// touches Task/AgentJob/ValidationAttempt state directly.
export function ExecutionHeader({
  projectId,
  overview,
  onChanged,
}: {
  projectId: string;
  overview: ProjectExecutionOverview;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exec = overview.activeSprintExecution;

  const handleStart = async (sprintId: string) => {
    setWorking(true);
    setError(null);
    try {
      await sprintExecutionApi.run(projectId, sprintId);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Could not start the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handlePause = async (sprintId: string) => {
    setWorking(true);
    setError(null);
    try {
      await sprintExecutionApi.pause(projectId, sprintId);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Could not pause the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handleResume = async (sprintId: string) => {
    setWorking(true);
    setError(null);
    try {
      await sprintExecutionApi.resume(projectId, sprintId);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Could not resume the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async (jobId: string) => {
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
      await jobsApi.cancel(projectId, jobId);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const isRunning = exec?.status === 'RUNNING';
  const isPaused = exec?.status === 'PAUSED';
  const isBlocked = exec?.status === 'BLOCKED';
  const canCancel = exec?.isLive && exec.backgroundJobId != null;

  return (
    <div className="page-header">
      <div>
        <h1>Development</h1>
        {exec ? (
          <p className="approval-panel-meta">
            Sprint {exec.sprintNumber} — {exec.sprintTitle}
          </p>
        ) : (
          <p className="approval-panel-meta">No Sprint has been run yet.</p>
        )}
      </div>

      <div className="project-detail-actions">
        {exec && <PhaseBadge phase={exec.currentPhase} />}
        {exec?.isLive && exec.startedAt && (
          <span className="approval-panel-meta">
            elapsed {formatElapsedSince(exec.startedAt)}
          </span>
        )}

        {overview.nextSprintEligible && !overview.hasActiveExecution && (
          <button
            type="button"
            disabled={working}
            onClick={() => handleStart(overview.nextSprintEligible!.sprintId)}
          >
            Start Sprint {overview.nextSprintEligible.number}
          </button>
        )}
        {isRunning && exec && (
          <button
            type="button"
            className="secondary"
            disabled={working || exec.pauseRequested}
            onClick={() => handlePause(exec.sprintId)}
          >
            {exec.pauseRequested ? 'Pause requested…' : 'Pause'}
          </button>
        )}
        {(isPaused || isBlocked) && exec && (
          <button type="button" disabled={working} onClick={() => handleResume(exec.sprintId)}>
            Resume
          </button>
        )}
        {canCancel && exec?.backgroundJobId && (
          <button
            type="button"
            className="secondary"
            disabled={working}
            onClick={() => handleCancel(exec.backgroundJobId!)}
          >
            Cancel
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {isRunning && exec?.pauseRequested && (
        <p className="approval-panel-meta">
          Pause requested. No new Task will start after the current one finishes — this may take
          a moment.
        </p>
      )}
      {isPaused && (
        <p className="approval-panel-meta">
          Sprint paused after {exec?.currentTaskId ? 'the current Task' : 'the last Task'}.
        </p>
      )}
      {exec?.status === 'CANCELLED' && (
        <p className="approval-panel-meta">
          This Sprint execution was cancelled. Any workspace changes already made were preserved,
          not reverted.
        </p>
      )}
    </div>
  );
}
