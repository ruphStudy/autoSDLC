import type { SprintPlan } from './types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SprintPlanMetadata({
  plan,
  architectureVersion,
}: {
  plan: SprintPlan;
  architectureVersion?: number;
}) {
  return (
    <details className="analysis-metadata">
      <summary>Version {plan.version} details</summary>
      <dl>
        <dt>Source</dt>
        <dd>{plan.source === 'AI_GENERATED' ? 'AI generated' : 'User edited'}</dd>
        {plan.basedOnVersion && (
          <>
            <dt>Based on plan</dt>
            <dd>Version {plan.basedOnVersion}</dd>
          </>
        )}
        <dt>Based on architecture</dt>
        <dd>{architectureVersion ? `Version ${architectureVersion}` : plan.architectureId}</dd>
        <dt>Generated</dt>
        <dd>{formatDateTime(plan.createdAt)}</dd>
        {plan.promptVersion && (
          <>
            <dt>Prompt</dt>
            <dd>
              {plan.promptName}:v{plan.promptVersion}
            </dd>
          </>
        )}
        {plan.provider && (
          <>
            <dt>Provider / model</dt>
            <dd>
              {plan.provider} / {plan.model}
            </dd>
          </>
        )}
        {plan.totalTokens != null && (
          <>
            <dt>Tokens</dt>
            <dd>
              {plan.inputTokens ?? '—'} in / {plan.outputTokens ?? '—'} out / {plan.totalTokens}{' '}
              total
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
