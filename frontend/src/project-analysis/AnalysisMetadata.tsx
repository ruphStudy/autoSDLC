import type { ProjectAnalysis } from './types';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AnalysisMetadata({ analysis }: { analysis: ProjectAnalysis }) {
  return (
    <details className="analysis-metadata">
      <summary>Version {analysis.version} details</summary>
      <dl>
        <dt>Source</dt>
        <dd>{analysis.source === 'AI_GENERATED' ? 'AI generated' : 'User edited'}</dd>
        {analysis.basedOnVersion && (
          <>
            <dt>Based on</dt>
            <dd>Version {analysis.basedOnVersion}</dd>
          </>
        )}
        <dt>Generated</dt>
        <dd>{formatDateTime(analysis.createdAt)}</dd>
        {analysis.promptVersion && (
          <>
            <dt>Prompt</dt>
            <dd>
              {analysis.promptName}:v{analysis.promptVersion}
            </dd>
          </>
        )}
        {analysis.provider && (
          <>
            <dt>Provider / model</dt>
            <dd>
              {analysis.provider} / {analysis.model}
            </dd>
          </>
        )}
        {analysis.totalTokens != null && (
          <>
            <dt>Tokens</dt>
            <dd>
              {analysis.inputTokens ?? '—'} in / {analysis.outputTokens ?? '—'} out /{' '}
              {analysis.totalTokens} total
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
