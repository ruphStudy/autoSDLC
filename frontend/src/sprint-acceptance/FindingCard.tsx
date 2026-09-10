import type { ReviewFinding } from './types';

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'paused',
  LOW: 'neutral',
  INFO: 'neutral',
};

const SEVERITY_ICON: Record<string, string> = {
  CRITICAL: '⛔',
  HIGH: '▲',
  MEDIUM: '●',
  LOW: '○',
  INFO: 'ℹ',
};

// Severity is always communicated by icon + text, never color alone (item
// 68/148).
export function FindingCard({ finding }: { finding: ReviewFinding }) {
  return (
    <li className="analysis-card">
      <div className="analysis-card-header">
        <strong>
          <span aria-hidden="true">{SEVERITY_ICON[finding.severity] ?? '●'}</span>{' '}
          {finding.title}
        </strong>
        <span className={`status-badge status-badge--${SEVERITY_TONE[finding.severity] ?? 'neutral'}`}>
          {finding.severity}
          {finding.blocking ? ' · Blocking' : ''}
        </span>
      </div>
      <p className="approval-panel-meta">{finding.category}</p>
      <p>{finding.description}</p>
      {finding.evidence.length > 0 && (
        <ul className="analysis-card-list">
          {finding.evidence.map((e, i) => (
            <li key={i} className="approval-panel-meta">
              {e}
            </li>
          ))}
        </ul>
      )}
      {(finding.relatedTaskKeys.length > 0 ||
        finding.relatedRequirementIds.length > 0 ||
        finding.relatedAdrIds.length > 0) && (
        <p className="approval-panel-meta">
          {finding.relatedTaskKeys.length > 0 && `Tasks: ${finding.relatedTaskKeys.join(', ')} `}
          {finding.relatedRequirementIds.length > 0 &&
            `Requirements: ${finding.relatedRequirementIds.join(', ')} `}
          {finding.relatedAdrIds.length > 0 && `ADRs: ${finding.relatedAdrIds.join(', ')}`}
        </p>
      )}
    </li>
  );
}
