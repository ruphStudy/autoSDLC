import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { approvalApi } from '../api/approval.api';
import type { ApprovalStage, ApprovalStatus } from './types';

const STAGE_LABEL: Record<ApprovalStage, string> = {
  ANALYSIS: 'Analysis',
  ARCHITECTURE: 'Architecture',
  SPRINT_PLAN: 'Sprint Plan',
  START_DEVELOPMENT: 'Start Development',
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

// Shared review panel embedded on the Project Analysis, Architecture, and
// Sprint Plan pages. Always reflects the CURRENT artifact version — a
// decision left over from an older, superseded version never counts as
// approving this one (see ApprovalService.isCurrentXApproved on the
// backend, which this panel's status endpoint mirrors exactly).
export function ApprovalPanel({
  projectId,
  stage,
  currentVersion,
  onDecided,
}: {
  projectId: string;
  stage: ApprovalStage;
  currentVersion: number;
  onDecided?: () => void;
}) {
  const [status, setStatus] = useState<ApprovalStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [comment, setComment] = useState('');

  const load = () => {
    approvalApi
      .getStatus(projectId, stage)
      .then(setStatus)
      .catch(() => setError('Could not load approval status.'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, stage, currentVersion]);

  if (!status) {
    return null;
  }

  const isCurrent = status.currentVersion === currentVersion;
  const isApproved = isCurrent && status.decision === 'APPROVED';
  const isChangesRequested = isCurrent && status.decision === 'CHANGES_REQUESTED';
  const label = isApproved ? 'Approved' : isChangesRequested ? 'Changes Requested' : 'Ready for Review';
  const tone = isApproved ? 'success' : isChangesRequested ? 'warning' : 'neutral';

  const handleApprove = async () => {
    if (!window.confirm(`Approve ${STAGE_LABEL[stage]} v${currentVersion}?`)) return;
    setWorking(true);
    setError(null);
    try {
      await approvalApi.decide(projectId, stage, { decision: 'APPROVED' });
      load();
      onDecided?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not approve. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRequestChanges = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim() || working) return;
    setWorking(true);
    setError(null);
    try {
      await approvalApi.decide(projectId, stage, {
        decision: 'CHANGES_REQUESTED',
        comment: comment.trim(),
      });
      setShowRequestChanges(false);
      setComment('');
      load();
      onDecided?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not submit feedback. Please try again.'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="approval-panel">
      <div className="approval-panel-header">
        <span className={`approval-badge approval-badge--${tone}`}>{label}</span>
        <span className="approval-panel-meta">Version {currentVersion}</span>
        {isCurrent && status.decidedAt && (
          <span className="approval-panel-meta">on {formatDate(status.decidedAt)}</span>
        )}
      </div>

      {isChangesRequested && status.comment && (
        <p className="approval-comment">&ldquo;{status.comment}&rdquo;</p>
      )}

      {error && <p className="form-error">{error}</p>}

      {!isApproved && !showRequestChanges && (
        <div className="approval-panel-actions">
          <button type="button" onClick={handleApprove} disabled={working}>
            Approve
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setShowRequestChanges(true)}
            disabled={working}
          >
            Request Changes
          </button>
        </div>
      )}

      {showRequestChanges && (
        <form className="approval-request-changes" onSubmit={handleRequestChanges}>
          <textarea
            rows={3}
            placeholder="What needs to change?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            required
          />
          <div className="approval-panel-actions">
            <button type="submit" disabled={working || !comment.trim()}>
              Submit Feedback
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowRequestChanges(false);
                setComment('');
              }}
              disabled={working}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
