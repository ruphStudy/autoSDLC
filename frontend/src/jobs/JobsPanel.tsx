import { useEffect, useState } from 'react';
import axios from 'axios';
import { jobsApi } from '../api/jobs.api';
import { ACTIVE_JOB_STATUSES, type Job, type JobStatus } from './types';

const STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  RETRY_WAIT: 'Retrying soon',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<JobStatus, string> = {
  QUEUED: 'neutral',
  RUNNING: 'progress',
  RETRY_WAIT: 'paused',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const JOB_TYPE_LABEL: Record<string, string> = {
  PROJECT_PREPARATION: 'Development Preparation',
  SYSTEM_TEST: 'System Test',
};

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Minimal job-monitoring UI for Project Detail: lists recent jobs for the
// project, offers "Prepare Development" once Sprint 7's Start Development
// approval is in place, and polls only while a job is still active.
export function JobsPanel({
  projectId,
  canPrepareDevelopment,
}: {
  projectId: string;
  canPrepareDevelopment: boolean;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = () => {
    jobsApi
      .list(projectId, { limit: 20 })
      .then(setJobs)
      .catch(() => setError('Could not load jobs.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!jobs || !jobs.some((job) => ACTIVE_JOB_STATUSES.includes(job.status))) {
      return;
    }
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const handlePrepare = async () => {
    setWorking(true);
    setError(null);
    try {
      await jobsApi.enqueue(projectId, 'PROJECT_PREPARATION');
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not queue development preparation. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    if (!window.confirm('Cancel this job?')) return;
    setError(null);
    try {
      await jobsApi.cancel(projectId, jobId);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not cancel the job.'));
    }
  };

  const hasActivePreparation = (jobs ?? []).some(
    (job) => job.type === 'PROJECT_PREPARATION' && ACTIVE_JOB_STATUSES.includes(job.status),
  );

  return (
    <section className="jobs-panel">
      <div className="page-header">
        <h3>Development Preparation</h3>
        {canPrepareDevelopment && (
          <button type="button" onClick={handlePrepare} disabled={working || hasActivePreparation}>
            Prepare Development
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!jobs && <p>Loading…</p>}
      {jobs && jobs.length === 0 && <p className="analysis-empty-section">No jobs yet.</p>}

      {jobs && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-card">
              <div className="job-card-header">
                <span>{JOB_TYPE_LABEL[job.type] ?? job.type}</span>
                <span className={`status-badge status-badge--${STATUS_TONE[job.status]}`}>
                  {STATUS_LABEL[job.status]}
                </span>
              </div>

              {(job.status === 'RUNNING' || job.status === 'RETRY_WAIT') && (
                <div className="job-progress-track">
                  <div className="job-progress-fill" style={{ width: `${job.progress}%` }} />
                </div>
              )}
              {job.progressMessage && <p className="approval-panel-meta">{job.progressMessage}</p>}

              <p className="approval-panel-meta">
                Attempt {job.attemptCount} of {job.maxAttempts} · Created {formatDate(job.createdAt)}
                {job.completedAt ? ` · Completed ${formatDate(job.completedAt)}` : ''}
              </p>

              {job.status === 'FAILED' && job.errorMessage && (
                <p className="form-error">{job.errorMessage}</p>
              )}

              {ACTIVE_JOB_STATUSES.includes(job.status) && (
                <button type="button" className="secondary" onClick={() => handleCancel(job.id)}>
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
