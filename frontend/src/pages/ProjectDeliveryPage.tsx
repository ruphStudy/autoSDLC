import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { projectDeliveryApi } from '../api/project-delivery.api';
import {
  COMPLETION_REASON_LABELS,
  type ProjectCompletionEligibility,
  type ProjectDeliveryRecord,
} from '../project-delivery/types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : '—';
}

const SPRINT_STATUS_TONE: Record<string, string> = {
  PASSED: 'success',
  RUNNING: 'progress',
  BLOCKED: 'danger',
  FAILED: 'danger',
};

// The Project-completion surface (Sprint 17) — the delivery-level
// counterpart to SprintReviewPage. Before completion this shows a live
// readiness checklist entirely computed server-side (never re-derived here);
// after completion it shows the immutable delivery manifest. Completion
// itself is a single explicit, confirmed human action — never automatic.
export function ProjectDeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id!;
  const [eligibility, setEligibility] = useState<ProjectCompletionEligibility | null>(null);
  const [delivery, setDelivery] = useState<ProjectDeliveryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await projectDeliveryApi.getCurrent(projectId).catch(() => null);
      setDelivery(current);
      if (!current) {
        const elig = await projectDeliveryApi.getEligibility(projectId);
        setEligibility(elig);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleComplete = async () => {
    if (
      !window.confirm(
        'Complete this project? This closes the development lifecycle — Sprints and Tasks can no longer be run or reviewed afterward.',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const result = await projectDeliveryApi.complete(projectId);
      setDelivery(result.delivery);
    } catch (err) {
      setError(errorMessage(err, 'Could not complete the project.'));
      await load();
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div className="analysis-content">
      <Link to={`/projects/${projectId}/development`} className="back-link">
        ← Back to Development
      </Link>

      <div className="page-header">
        <div>
          <h1>Project Delivery</h1>
        </div>
        {delivery && <span className="status-badge status-badge--success">COMPLETED</span>}
      </div>

      {error && <p className="form-error">{error}</p>}

      {!delivery && eligibility && (
        <>
          <section className="workspace-panel">
            <h3>Completion Readiness</h3>
            {eligibility.eligible ? (
              <p>This project has met every requirement for completion.</p>
            ) : (
              <ul className="analysis-card-list">
                {eligibility.reasons.map((reason) => (
                  <li key={reason} className="approval-panel-meta">
                    {COMPLETION_REASON_LABELS[reason] ?? reason}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="workspace-panel">
            <div className="project-detail-actions">
              <button type="button" onClick={handleComplete} disabled={!eligibility.eligible || working}>
                Complete Project
              </button>
              <button type="button" className="secondary" onClick={() => void load()} disabled={working}>
                Refresh
              </button>
            </div>
          </section>
        </>
      )}

      {delivery && (
        <>
          <section className="workspace-panel">
            <h3>Delivery Summary</h3>
            <p>{delivery.deliverySummary}</p>
            <p className="approval-panel-meta">
              Final commit: <code>{shortSha(delivery.repositoryFinalSha)}</code>
              {delivery.repositoryBranch && ` on branch ${delivery.repositoryBranch}`}
            </p>
            <p className="approval-panel-meta">
              Completed {new Date(delivery.finalizedAt).toLocaleString()}
            </p>
          </section>

          {delivery.warnings.length > 0 && (
            <section className="workspace-panel">
              <h3>Warnings</h3>
              <ul className="analysis-card-list">
                {delivery.warnings.map((w, i) => (
                  <li key={i} className="form-error">
                    {w}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="workspace-panel">
            <h3>Sprints Delivered</h3>
            <ul className="analysis-card-list">
              {delivery.requiredSprints.map((s) => (
                <li key={s.sprintId} className="analysis-card">
                  <div className="analysis-card-header">
                    <strong>
                      Sprint {s.number} — {s.title}
                    </strong>
                    <span
                      className={`status-badge status-badge--${SPRINT_STATUS_TONE[s.status] ?? 'neutral'}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <p className="approval-panel-meta">
                    Accepted v{s.acceptanceVersion ?? '—'} · Final commit{' '}
                    <code>{shortSha(s.repositoryEndSha)}</code>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="workspace-panel">
            <h3>Requirement Coverage</h3>
            <ul className="analysis-card-list">
              {delivery.requirementCoverage.map((r) => (
                <li key={r.requirementId} className="analysis-card">
                  <div className="analysis-card-header">
                    <strong>
                      {r.requirementId} — {r.title}
                    </strong>
                    <span
                      className={`status-badge status-badge--${r.covered ? 'success' : 'danger'}`}
                    >
                      {r.covered ? 'Covered' : 'Gap'}
                    </span>
                  </div>
                  <p className="approval-panel-meta">{r.taskKeys.join(', ')}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="workspace-panel">
            <h3>Tasks &amp; Validation</h3>
            <p className="approval-panel-meta">
              {delivery.taskSummary.passedTasks}/{delivery.taskSummary.totalTasks} Tasks passed ·{' '}
              {delivery.validationSummary.requiredPassed}/
              {delivery.validationSummary.requiredPassed + delivery.validationSummary.requiredFailed}{' '}
              required checks passed
            </p>
          </section>

          <section className="workspace-panel">
            <h3>Commits</h3>
            <p className="approval-panel-meta">
              {delivery.commitSummary.totalCommits} commit(s) —{' '}
              <code>{shortSha(delivery.commitSummary.firstCommitSha)}</code> to{' '}
              <code>{shortSha(delivery.commitSummary.lastCommitSha)}</code>
            </p>
          </section>

          <details className="workspace-panel">
            <summary>Usage summary</summary>
            <p className="approval-panel-meta">
              {delivery.usageSummary.totalInputTokens} tokens in /{' '}
              {delivery.usageSummary.totalOutputTokens} tokens out across the whole project.
            </p>
            <ul className="analysis-card-list">
              {delivery.usageSummary.byCategory.map((c) => (
                <li key={c.category} className="approval-panel-meta">
                  {c.category}: {c.totalTokens} tokens
                </li>
              ))}
            </ul>
          </details>

          <details className="workspace-panel">
            <summary>Delivery metadata</summary>
            <p className="approval-panel-meta">Evidence hash: {delivery.deliveryEvidenceHash.slice(0, 16)}</p>
            <p className="approval-panel-meta">Delivery version: {delivery.version}</p>
          </details>

          <p className="approval-panel-meta">
            No external Git push was performed and nothing was deployed. This delivery
            references the exact clean development-branch commit above.
          </p>
        </>
      )}
    </div>
  );
}
