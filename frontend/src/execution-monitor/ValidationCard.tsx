import type { ValidationActivitySummary } from './types';
import { StatusText } from './PhaseBadge';
import { formatDuration } from './format';

// Deterministic validation, never AI (item 158) — the copy here
// deliberately never mentions a model or provider.
export function ValidationCard({ validation }: { validation: ValidationActivitySummary | null }) {
  if (!validation) return null;

  return (
    <section className="workspace-panel">
      <div className="job-card-header">
        <h3>Validation</h3>
        <span className="approval-panel-meta">Attempt {validation.attempt}</span>
        <StatusText status={validation.status} />
      </div>
      <p className="approval-panel-meta">
        {validation.requiredPassed} required passed
        {validation.requiredFailed > 0 && `, ${validation.requiredFailed} failed`}
        {validation.optionalPassed + validation.optionalFailed > 0 &&
          ` · ${validation.optionalPassed} optional passed`}
      </p>
      {validation.checks.length > 0 && (
        <ul className="analysis-card-list">
          {validation.checks.map((check, i) => (
            <li key={`${check.type}-${i}`} className="analysis-card">
              <div className="analysis-card-header">
                <strong>
                  {check.name} <span className="approval-panel-meta">
                    {check.required ? '(required)' : '(optional)'}
                  </span>
                </strong>
                <StatusText status={check.status} />
              </div>
              <p className="approval-panel-meta">
                {check.durationMs != null && `${formatDuration(check.durationMs)}`}
                {check.exitCode != null && ` · exit ${check.exitCode}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {validation.commitSha && (
        <p className="analysis-empty-section">
          Local commit <code>{validation.commitSha.slice(0, 10)}</code>
        </p>
      )}
      {validation.status === 'FAILED' && validation.errorMessage && (
        <p className="form-error">{validation.errorMessage}</p>
      )}
    </section>
  );
}
