import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { sprintAcceptanceApi } from '../api/sprint-acceptance.api';
import { sprintPlanningApi } from '../api/sprint-planning.api';
import { FindingCard } from '../sprint-acceptance/FindingCard';
import {
  ACTIVE_ACCEPTANCE_STATUSES,
  type SprintAcceptanceRecord,
} from '../sprint-acceptance/types';
import type { Sprint } from '../sprint-planning/types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  ACCEPT: 'Recommended: ACCEPT',
  ACCEPT_WITH_NOTES: 'Recommended: ACCEPT WITH NOTES',
  NEEDS_ATTENTION: 'Recommended: NEEDS ATTENTION',
  REJECT: 'Recommended: REJECT',
};

const RECOMMENDATION_TONE: Record<string, string> = {
  ACCEPT: 'success',
  ACCEPT_WITH_NOTES: 'success',
  NEEDS_ATTENTION: 'paused',
  REJECT: 'danger',
};

const STATUS_TONE: Record<string, string> = {
  PENDING: 'neutral',
  REVIEWING: 'progress',
  READY_FOR_DECISION: 'progress',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : '—';
}

// The engineering-delivery acceptance review UI (item 145) — deliberately
// structured so "verified by the deterministic system" and "independent AI
// assessment" are always visually distinct sections (item 65/66/67); the
// AI's recommendation is shown but never auto-applied — Accept/Reject are
// always separate, explicit human actions (item 70/116).
export function SprintReviewPage() {
  const { id, sprintId } = useParams<{ id: string; sprintId: string }>();
  const projectId = id!;
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [acceptance, setAcceptance] = useState<SprintAcceptanceRecord | null>(null);
  const [history, setHistory] = useState<SprintAcceptanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const [plan, current, versions] = await Promise.all([
        sprintPlanningApi.getSprintPlan(projectId).catch(() => null),
        sprintAcceptanceApi.getCurrent(projectId, sprintId!).catch(() => null),
        sprintAcceptanceApi.getHistory(projectId, sprintId!).catch(() => []),
      ]);
      if (plan) {
        setSprint(plan.sprints.find((s) => s.id === sprintId) ?? null);
      }
      setAcceptance(current);
      setHistory(versions);
      setNotFound(!current && versions.length === 0);
    } finally {
      setLoading(false);
    }
  }, [projectId, sprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!acceptance || !ACTIVE_ACCEPTANCE_STATUSES.includes(acceptance.status)) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [acceptance, load]);

  const handleGenerate = async () => {
    setWorking(true);
    setError(null);
    try {
      await sprintAcceptanceApi.generate(projectId, sprintId!);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not generate the acceptance review.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRegenerate = async () => {
    setWorking(true);
    setError(null);
    try {
      await sprintAcceptanceApi.regenerate(projectId, sprintId!);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not regenerate the acceptance review.'));
    } finally {
      setWorking(false);
    }
  };

  const handleAccept = async () => {
    if (!window.confirm('Accept this Sprint? This decision cannot be changed afterward.')) return;
    setWorking(true);
    setError(null);
    try {
      const updated = await sprintAcceptanceApi.accept(projectId, sprintId!);
      setAcceptance(updated);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not accept the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('A reason is required to reject a Sprint.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const updated = await sprintAcceptanceApi.reject(projectId, sprintId!, rejectReason.trim());
      setAcceptance(updated);
      setShowRejectForm(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not reject the Sprint.'));
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <p>Loading…</p>;

  const isActive = acceptance ? ACTIVE_ACCEPTANCE_STATUSES.includes(acceptance.status) : false;
  const canDecide =
    acceptance?.status === 'READY_FOR_DECISION' && !acceptance.stale && !working;

  return (
    <div className="analysis-content">
      <Link to={`/projects/${projectId}/development`} className="back-link">
        ← Back to Development
      </Link>

      <div className="page-header">
        <div>
          <h1>Sprint Review{sprint ? ` — Sprint ${sprint.number}: ${sprint.title}` : ''}</h1>
          {sprint && <p className="approval-panel-meta">{sprint.objective}</p>}
        </div>
        <div className="project-detail-actions">
          {acceptance && (
            <span className={`status-badge status-badge--${STATUS_TONE[acceptance.status] ?? 'neutral'}`}>
              {acceptance.status.replace(/_/g, ' ')}
              {acceptance.version ? ` (v${acceptance.version})` : ''}
            </span>
          )}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {notFound && !acceptance && (
        <section className="workspace-panel">
          <p>No acceptance review has been generated for this Sprint yet.</p>
          <button type="button" onClick={handleGenerate} disabled={working}>
            Generate Review
          </button>
        </section>
      )}

      {acceptance && (
        <>
          {isActive && (
            <section className="workspace-panel">
              <p className="approval-panel-meta">
                {acceptance.status === 'PENDING'
                  ? 'Review queued…'
                  : 'Collecting evidence and requesting an independent AI review…'}
              </p>
            </section>
          )}

          {acceptance.stale && acceptance.status === 'READY_FOR_DECISION' && (
            <section className="workspace-panel">
              <p className="form-error">
                The Sprint's repository state has changed since this review was generated. This
                review is stale and cannot be accepted or rejected.
              </p>
              <button type="button" onClick={handleRegenerate} disabled={working}>
                Regenerate Review
              </button>
            </section>
          )}

          <section className="workspace-panel">
            <h3>Delivery Summary — Verified by system</h3>
            <p>{acceptance.deterministicSummary ?? 'Evidence not yet collected.'}</p>
            {acceptance.commitSummary && (
              <p className="approval-panel-meta">
                Final commit: <code>{shortSha(acceptance.commitSummary.endSha)}</code>
                {acceptance.commitSummary.chainComplete ? ' · Commit chain complete' : ' · Commit chain incomplete'}
              </p>
            )}
          </section>

          {acceptance.requirementCoverage && acceptance.requirementCoverage.length > 0 && (
            <section className="workspace-panel">
              <h3>Requirement Coverage — Verified by system</h3>
              <ul className="analysis-card-list">
                {acceptance.requirementCoverage.map((r) => (
                  <li key={r.requirementId} className="analysis-card">
                    <div className="analysis-card-header">
                      <strong>
                        {r.requirementId} — {r.title}
                      </strong>
                      <span
                        className={`status-badge status-badge--${
                          r.tasksPassed && r.validationPassed ? 'success' : 'danger'
                        }`}
                      >
                        {r.tasksPassed && r.validationPassed ? 'Covered' : 'Gap'}
                      </span>
                    </div>
                    <p className="approval-panel-meta">
                      {r.taskKeys.join(', ')}
                      {r.commitShas.length > 0 && ` · ${r.commitShas.map(shortSha).join(', ')}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {acceptance.validationSummary && (
            <section className="workspace-panel">
              <h3>Validation Evidence — Verified by system</h3>
              <p className="approval-panel-meta">
                {acceptance.validationSummary.requiredPassed}/{acceptance.validationSummary.requiredRuns}{' '}
                required checks passed
                {acceptance.validationSummary.optionalFailed > 0 &&
                  ` · ${acceptance.validationSummary.optionalFailed} optional check(s) failed`}
              </p>
            </section>
          )}

          {acceptance.aiReviewStatus === 'FAILED' && (
            <section className="workspace-panel">
              <p className="approval-panel-meta">
                Automated review is temporarily unavailable. All deterministic delivery checks
                passed. You may regenerate the review or complete a manual acceptance decision.
              </p>
            </section>
          )}

          {acceptance.aiReviewStatus === 'COMPLETED' && (
            <>
              <section className="workspace-panel">
                <h3>Independent AI Review</h3>
                <p className="approval-panel-meta">
                  {acceptance.provider} · {acceptance.model}
                </p>
                <p>{acceptance.aiSummary}</p>
              </section>

              {acceptance.objectiveAssessment && (
                <section className="workspace-panel">
                  <h3>Objective Assessment</h3>
                  <p>
                    {acceptance.objectiveAssessment.satisfied ? 'Satisfied — ' : 'Not fully satisfied — '}
                    {acceptance.objectiveAssessment.rationale}
                  </p>
                </section>
              )}

              {acceptance.architectureAssessment && (
                <section className="workspace-panel">
                  <h3>Architecture / ADR Review</h3>
                  <p className="approval-panel-meta">
                    Reviewer assessment, not deterministic proof.
                  </p>
                  <p>{acceptance.architectureAssessment.aligned ? 'Aligned with the approved Architecture.' : 'Potential architecture concerns found.'}</p>
                  {acceptance.architectureAssessment.concerns.length > 0 && (
                    <ul className="analysis-card-list">
                      {acceptance.architectureAssessment.concerns.map((c, i) => (
                        <li key={i} className="approval-panel-meta">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {acceptance.riskAssessment && (
                <section className="workspace-panel">
                  <h3>Risks / Notes</h3>
                  <p>{acceptance.riskAssessment.acceptable ? 'No unacceptable risk identified.' : 'Risk concerns raised.'}</p>
                  {acceptance.riskAssessment.concerns.length > 0 && (
                    <ul className="analysis-card-list">
                      {acceptance.riskAssessment.concerns.map((c, i) => (
                        <li key={i} className="approval-panel-meta">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {acceptance.findings && acceptance.findings.length > 0 && (
                <section className="workspace-panel">
                  <h3>Review Findings</h3>
                  <ul className="analysis-card-list">
                    {acceptance.findings.map((f) => (
                      <FindingCard key={f.id} finding={f} />
                    ))}
                  </ul>
                </section>
              )}

              {acceptance.recommendation && (
                <section className="workspace-panel">
                  <h3>Final Recommendation</h3>
                  <span
                    className={`status-badge status-badge--${RECOMMENDATION_TONE[acceptance.recommendation] ?? 'neutral'}`}
                  >
                    {RECOMMENDATION_LABEL[acceptance.recommendation] ?? acceptance.recommendation}
                  </span>
                </section>
              )}
            </>
          )}

          {(acceptance.status === 'ACCEPTED' || acceptance.status === 'REJECTED') && (
            <section className="workspace-panel">
              <h3>Decision</h3>
              <p>
                {acceptance.status === 'ACCEPTED' ? 'Accepted' : 'Rejected'} by reviewer on{' '}
                {acceptance.reviewedAt ? new Date(acceptance.reviewedAt).toLocaleString() : '—'}.
              </p>
              {acceptance.reviewerNotes && <p className="approval-panel-meta">Notes: {acceptance.reviewerNotes}</p>}
              {acceptance.rejectionReason && <p className="form-error">Reason: {acceptance.rejectionReason}</p>}
            </section>
          )}

          {acceptance.status === 'READY_FOR_DECISION' && (
            <section className="workspace-panel">
              <h3>Accept / Reject</h3>
              <div className="project-detail-actions">
                <button type="button" onClick={handleAccept} disabled={!canDecide}>
                  Accept Sprint
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowRejectForm((v) => !v)}
                  disabled={!canDecide}
                >
                  Reject Sprint
                </button>
                <button type="button" className="secondary" onClick={handleRegenerate} disabled={working}>
                  Regenerate
                </button>
              </div>
              {showRejectForm && (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    aria-label="Rejection reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain why this Sprint is being rejected…"
                    rows={3}
                    style={{ width: '100%' }}
                  />
                  <button type="button" className="destructive" onClick={handleReject} disabled={working}>
                    Confirm Reject
                  </button>
                </div>
              )}
            </section>
          )}

          <details className="workspace-panel">
            <summary>Review metadata</summary>
            <p className="approval-panel-meta">Prompt: {acceptance.promptName ?? '—'} v{acceptance.promptVersion ?? '—'}</p>
            <p className="approval-panel-meta">
              Tokens: {acceptance.inputTokens ?? 0} in / {acceptance.outputTokens ?? 0} out
            </p>
            <p className="approval-panel-meta">Evidence hash: {acceptance.evidenceHash?.slice(0, 16) ?? '—'}</p>
            <p className="approval-panel-meta">Reviewed HEAD: {shortSha(acceptance.repositoryHeadSha)}</p>
          </details>

          {history.length > 1 && (
            <section className="workspace-panel">
              <h3>Review History</h3>
              <ul className="analysis-card-list">
                {history.map((h) => (
                  <li key={h.id} className="analysis-card">
                    <div className="analysis-card-header">
                      <strong>Review v{h.version}</strong>
                      <span className={`status-badge status-badge--${STATUS_TONE[h.status] ?? 'neutral'}`}>
                        {h.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
