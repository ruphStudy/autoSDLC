import type { AgentActivitySummary } from './types';
import { StatusText } from './PhaseBadge';
import { formatDuration } from './format';

// Provider-neutral labeling throughout (item 156/157) — the heading always
// says "Coding Agent", the specific provider name is rendered from data,
// never hardcoded to "Claude".
export function AgentActivityCard({ agent }: { agent: AgentActivitySummary | null }) {
  if (!agent) return null;
  const toolEntries = Object.entries(agent.toolActivityCounts);

  return (
    <section className="workspace-panel">
      <div className="job-card-header">
        <h3>Coding Agent: {agent.provider}</h3>
        <StatusText status={agent.status} />
      </div>
      {agent.model && <p className="approval-panel-meta">Model: {agent.model}</p>}
      <p className="approval-panel-meta">
        {agent.durationMs != null && `${formatDuration(agent.durationMs)} · `}
        {agent.inputTokens != null && agent.outputTokens != null
          ? `${agent.inputTokens} in / ${agent.outputTokens} out tokens`
          : 'Usage unavailable'}
        {agent.turns != null && ` · ${agent.turns} turn${agent.turns === 1 ? '' : 's'}`}
      </p>
      <p className="approval-panel-meta">
        {agent.changedFileCount} file{agent.changedFileCount === 1 ? '' : 's'} changed ·{' '}
        {agent.commandActivityCount} command{agent.commandActivityCount === 1 ? '' : 's'} run
      </p>
      {toolEntries.length > 0 && (
        <p className="approval-panel-meta">
          Tool activity: {toolEntries.map(([tool, count]) => `${tool} (${count})`).join(', ')}
        </p>
      )}
      {agent.summary && <p>{agent.summary}</p>}
      {agent.status === 'FAILED' && agent.errorMessage && (
        <p className="form-error">{agent.errorMessage}</p>
      )}
    </section>
  );
}
