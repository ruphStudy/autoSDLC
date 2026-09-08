import { useEffect, useState } from 'react';
import axios from 'axios';
import { approvalApi } from '../api/approval.api';
import type { ApprovalSummary } from './types';

function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

// The final explicit human gate before development execution: only enabled
// once the CURRENT Analysis, Architecture, and Sprint Plan are all
// approved. This never starts a coding agent — Sprint 7 only records the
// decision that unlocks a future execution sprint.
export function StartDevelopmentPanel({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    approvalApi
      .getSummary(projectId)
      .then(setSummary)
      .catch(() => setError('Could not load approval summary.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!summary) {
    return null;
  }

  const allApproved =
    summary.analysis.decision === 'APPROVED' &&
    summary.architecture.decision === 'APPROVED' &&
    summary.sprintPlan.decision === 'APPROVED';
  const alreadyApproved = summary.startDevelopment.decision === 'APPROVED';

  const handleApprove = async () => {
    if (!window.confirm('Approve this project to begin development?')) return;
    setWorking(true);
    setError(null);
    try {
      await approvalApi.decide(projectId, 'START_DEVELOPMENT', { decision: 'APPROVED' });
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not approve Start Development. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="approval-panel">
      <div className="approval-panel-header">
        <strong>Start Development</strong>
        {alreadyApproved && (
          <span className="approval-badge approval-badge--success">Development Approved</span>
        )}
      </div>

      {!alreadyApproved && (
        <>
          {!allApproved && (
            <p className="approval-panel-meta">
              Locked until the current Analysis, Architecture, and Sprint Plan are all approved.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="approval-panel-actions">
            <button type="button" onClick={handleApprove} disabled={working || !allApproved}>
              Approve Start Development
            </button>
          </div>
        </>
      )}

      {alreadyApproved && (
        <p className="approval-panel-meta">
          Development execution is not implemented yet — this project is ready and waiting for a
          future execution sprint.
        </p>
      )}
    </section>
  );
}
