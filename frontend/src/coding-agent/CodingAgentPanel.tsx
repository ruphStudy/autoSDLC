import { useEffect, useState } from 'react';
import axios from 'axios';
import { codingAgentApi } from '../api/coding-agent.api';
import { ACTIVE_AGENT_JOB_STATUSES, type AgentJob, type AgentJobStatus, type CodingAgentHealth } from './types';

const STATUS_LABEL: Record<AgentJobStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<AgentJobStatus, string> = {
  QUEUED: 'neutral',
  RUNNING: 'progress',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

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

// Infrastructure diagnostic only (Sprint 10) — always runs a fixed,
// backend-generated read-only instruction. Deliberately has no free-form
// prompt input: this is not a chat-with-code interface, and the frontend
// never chooses the provider, model, or instruction (those are
// server-controlled).
export function CodingAgentPanel({
  projectId,
  canPrepareDevelopment,
}: {
  projectId: string;
  canPrepareDevelopment: boolean;
}) {
  const [health, setHealth] = useState<CodingAgentHealth | null>(null);
  const [jobs, setJobs] = useState<AgentJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = () => {
    codingAgentApi
      .list(projectId, 5)
      .then(setJobs)
      .catch(() => setError('Could not load coding agent jobs.'));
  };

  useEffect(() => {
    codingAgentApi.health().then(setHealth).catch(() => setHealth(null));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!jobs || !jobs.some((job) => ACTIVE_AGENT_JOB_STATUSES.includes(job.status))) {
      return;
    }
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const handleRunDiagnostic = async () => {
    setWorking(true);
    setError(null);
    try {
      await codingAgentApi.runDiagnostic(projectId);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not run the coding agent diagnostic. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const hasActiveDiagnostic = (jobs ?? []).some((job) =>
    ACTIVE_AGENT_JOB_STATUSES.includes(job.status),
  );

  return (
    <section className="workspace-panel">
      <div className="page-header">
        <h3>Coding Agent</h3>
        {canPrepareDevelopment && (
          <button type="button" onClick={handleRunDiagnostic} disabled={working || hasActiveDiagnostic}>
            Run Diagnostic
          </button>
        )}
      </div>

      <p className="approval-panel-meta">
        Provider: {health?.provider ?? 'claude'} · Model: {health?.model ?? '—'} · Status:{' '}
        {health === null
          ? 'Unknown'
          : !health.configured
            ? 'Not configured'
            : health.reachable
              ? 'Configured'
              : 'Configured (unreachable)'}
      </p>

      {error && <p className="form-error">{error}</p>}
      {!jobs && <p>Loading…</p>}
      {jobs && jobs.length === 0 && <p className="analysis-empty-section">No diagnostic runs yet.</p>}

      {jobs && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-card">
              <div className="job-card-header">
                <span>Diagnostic</span>
                <span className={`status-badge status-badge--${STATUS_TONE[job.status]}`}>
                  {STATUS_LABEL[job.status]}
                </span>
              </div>
              <p className="approval-panel-meta">
                Started {formatDate(job.startedAt)}
                {job.durationMs != null ? ` · ${job.durationMs}ms` : ''}
                {job.turns != null ? ` · ${job.turns} turn${job.turns === 1 ? '' : 's'}` : ''}
              </p>
              {job.summary && <p className="approval-panel-meta">{job.summary}</p>}
              {job.status === 'FAILED' && job.errorMessage && (
                <p className="form-error">{job.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
