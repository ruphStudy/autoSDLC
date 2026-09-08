import { useEffect, useState } from 'react';
import { approvalApi } from '../api/approval.api';
import type { ApprovalRecord, ApprovalStage } from './types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Read-only approval state for a historical (non-current) artifact version.
// Approval actions only ever apply to the current version — this never
// renders Approve/Request Changes controls, only what was decided at the
// time, if anything.
export function HistoricalApprovalBadge({
  projectId,
  stage,
  version,
}: {
  projectId: string;
  stage: ApprovalStage;
  version: number;
}) {
  const [decision, setDecision] = useState<ApprovalRecord | null | undefined>(undefined);

  useEffect(() => {
    approvalApi
      .getHistory(projectId, stage)
      .then((history) => {
        const forVersion = history.find((r) => r.artifactVersion === version);
        setDecision(forVersion ?? null);
      })
      .catch(() => setDecision(null));
  }, [projectId, stage, version]);

  if (decision === undefined) {
    return null;
  }

  if (!decision) {
    return (
      <p className="approval-panel-meta">Version {version} was never reviewed.</p>
    );
  }

  const label = decision.decision === 'APPROVED' ? 'Approved' : 'Changes Requested';
  const tone = decision.decision === 'APPROVED' ? 'success' : 'warning';

  return (
    <div className="approval-panel">
      <div className="approval-panel-header">
        <span className={`approval-badge approval-badge--${tone}`}>{label}</span>
        <span className="approval-panel-meta">on {formatDate(decision.decidedAt)}</span>
      </div>
      {decision.comment && <p className="approval-comment">&ldquo;{decision.comment}&rdquo;</p>}
    </div>
  );
}
