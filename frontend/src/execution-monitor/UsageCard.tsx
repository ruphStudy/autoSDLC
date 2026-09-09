import type { ExecutionUsageSummary } from './types';

// Raw token counts only — no cost/credits anywhere (item 16/74/98).
export function UsageCard({ usage }: { usage: ExecutionUsageSummary }) {
  const hasAny = usage.codingAgent.totalTokens > 0 || usage.planningAi.totalTokens > 0;
  if (!hasAny) return null;

  return (
    <section className="workspace-panel">
      <h3>Token Usage</h3>
      <p className="approval-panel-meta">
        Coding Agent: {usage.codingAgent.inputTokens} in / {usage.codingAgent.outputTokens} out
        ({usage.codingAgent.totalTokens} total)
      </p>
      <p className="approval-panel-meta">
        Planning AI: {usage.planningAi.inputTokens} in / {usage.planningAi.outputTokens} out (
        {usage.planningAi.totalTokens} total)
      </p>
    </section>
  );
}
