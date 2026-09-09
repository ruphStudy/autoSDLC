import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { taskValidationApi } from '../api/task-validation.api';
import {
  ACTIVE_VALIDATION_ATTEMPT_STATUSES,
  type TaskValidationEligibility,
  type ValidationAttempt,
  type ValidationRun,
} from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

const RUN_STATUS_TONE: Record<ValidationRun['status'], string> = {
  PENDING: 'neutral',
  RUNNING: 'progress',
  PASSED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
};

const ATTEMPT_STATUS_TONE: Record<ValidationAttempt['status'], string> = {
  QUEUED: 'neutral',
  RUNNING: 'progress',
  PASSED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

function CheckRow({ run }: { run: ValidationRun }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = Boolean(run.stdout || run.stderr);

  return (
    <li className="analysis-card">
      <div className="analysis-card-header">
        <strong>
          {run.name} <span className="approval-panel-meta">{run.required ? '(required)' : '(optional)'}</span>
        </strong>
        <span className={`status-badge status-badge--${RUN_STATUS_TONE[run.status]}`}>{run.status}</span>
      </div>
      <p className="approval-panel-meta">
        {run.command} {run.args.join(' ')}
        {run.workingDirectory ? ` (in ${run.workingDirectory})` : ''}
        {run.durationMs != null ? ` · ${run.durationMs}ms` : ''}
        {run.exitCode != null ? ` · exit ${run.exitCode}` : ''}
      </p>
      {hasOutput && (
        <>
          <button type="button" className="secondary" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide output' : 'Show output'}
          </button>
          {expanded && (
            <pre className="workspace-diff">
              {run.stdout}
              {run.stderr}
              {run.outputTruncated ? '\n… output truncated …' : ''}
            </pre>
          )}
        </>
      )}
    </li>
  );
}

// Deterministic validation (Sprint 13) — the only way a Task ever reaches
// PASSED. Deliberately no "Mark Task Passed" override anywhere in this UI:
// that decision belongs entirely to the Validation Engine.
export function TaskValidationPanel({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const [eligibility, setEligibility] = useState<TaskValidationEligibility | null>(null);
  const [attempt, setAttempt] = useState<ValidationAttempt | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eligibilityResult, attempts] = await Promise.all([
        taskValidationApi.getEligibility(projectId, taskId),
        taskValidationApi.listValidations(projectId, taskId),
      ]);
      setEligibility(eligibilityResult);
      setAttempt(attempts[0] ?? null);
    } catch {
      // Transient load failure — the next poll or manual action will retry.
    }
  }, [projectId, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!attempt || !ACTIVE_VALIDATION_ATTEMPT_STATUSES.includes(attempt.status)) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [attempt, load]);

  const handleValidate = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await taskValidationApi.validate(projectId, taskId);
      setAttempt(result.validationAttempt);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not start validation. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const isActive = attempt ? ACTIVE_VALIDATION_ATTEMPT_STATUSES.includes(attempt.status) : false;
  const canValidate = eligibility?.runnable === true && !isActive;

  // Only relevant once the Task has actually reached REVIEWING at least
  // once — before that, Sprint 12's own panel owns the visible workflow.
  if (!eligibility) return null;
  const everRelevant =
    eligibility.task.status === 'REVIEWING' ||
    eligibility.task.status === 'PASSED' ||
    attempt !== null;
  if (!everRelevant) return null;

  return (
    <div className="workspace-panel" style={{ marginTop: 8 }}>
      <div className="job-card-header">
        <strong>Validation</strong>
        {attempt && (
          <span className={`status-badge status-badge--${ATTEMPT_STATUS_TONE[attempt.status]}`}>
            Attempt {attempt.attempt} · {attempt.status}
          </span>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="project-detail-actions" style={{ marginTop: 4 }}>
        <button type="button" onClick={handleValidate} disabled={!canValidate || working}>
          Validate Task
        </button>
      </div>

      {!canValidate && !isActive && eligibility.reasons.length > 0 && (
        <p className="approval-panel-meta">Not runnable: {eligibility.reasons.join(', ')}</p>
      )}

      {isActive && (
        <p className="approval-panel-meta">
          Validating implementation… ({attempt!.requiredPassed + attempt!.optionalPassed} of{' '}
          {attempt!.runs.length || '…'} checks complete)
        </p>
      )}

      {attempt && attempt.runs.length > 0 && (
        <ul className="analysis-card-list">
          {attempt.runs.map((run) => (
            <CheckRow key={run.id} run={run} />
          ))}
        </ul>
      )}

      {attempt && attempt.status === 'PASSED' && (
        <p className="analysis-empty-section">
          Task Passed. Committed as <code>{attempt.commitSha?.slice(0, 10)}</code>.
        </p>
      )}

      {attempt && attempt.status === 'FAILED' && (
        <div>
          <p className="form-error">Validation Failed — {attempt.errorMessage ?? 'one or more required checks did not pass.'}</p>
          <p className="approval-panel-meta">
            The workspace was left dirty for debugging. This Task will not be retried automatically.
          </p>
        </div>
      )}

      {attempt && attempt.status === 'CANCELLED' && (
        <p className="approval-panel-meta">Validation was cancelled. No commit was made.</p>
      )}
    </div>
  );
}
