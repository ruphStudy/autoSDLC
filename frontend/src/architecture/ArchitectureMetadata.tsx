import type { Architecture } from './types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ArchitectureMetadata({
  architecture,
  analysisVersion,
}: {
  architecture: Architecture;
  analysisVersion?: number;
}) {
  return (
    <details className="analysis-metadata">
      <summary>Version {architecture.version} details</summary>
      <dl>
        <dt>Source</dt>
        <dd>{architecture.source === 'AI_GENERATED' ? 'AI generated' : 'User edited'}</dd>
        {architecture.basedOnVersion && (
          <>
            <dt>Based on architecture</dt>
            <dd>Version {architecture.basedOnVersion}</dd>
          </>
        )}
        <dt>Based on analysis</dt>
        <dd>{analysisVersion ? `Version ${analysisVersion}` : architecture.projectAnalysisId}</dd>
        <dt>Generated</dt>
        <dd>{formatDateTime(architecture.createdAt)}</dd>
        {architecture.promptVersion && (
          <>
            <dt>Prompt</dt>
            <dd>
              {architecture.promptName}:v{architecture.promptVersion}
            </dd>
          </>
        )}
        {architecture.provider && (
          <>
            <dt>Provider / model</dt>
            <dd>
              {architecture.provider} / {architecture.model}
            </dd>
          </>
        )}
        {architecture.totalTokens != null && (
          <>
            <dt>Tokens</dt>
            <dd>
              {architecture.inputTokens ?? '—'} in / {architecture.outputTokens ?? '—'} out /{' '}
              {architecture.totalTokens} total
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
