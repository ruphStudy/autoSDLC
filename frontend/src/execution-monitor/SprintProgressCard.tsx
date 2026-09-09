import type { SprintProgressSummary } from './types';
import { StatusText } from './PhaseBadge';

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      style={{
        background: 'var(--border, #e2e2e2)',
        borderRadius: 4,
        height: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${percent}%`,
          background: 'var(--accent, #2f6feb)',
          height: '100%',
        }}
      />
    </div>
  );
}

// Every Sprint in the current plan, not just the active one (item 90/104) —
// lets the user see what already completed and what is still ahead without
// leaving the Development page.
export function SprintProgressCard({
  sprints,
  activeSprintId,
}: {
  sprints: SprintProgressSummary[];
  activeSprintId: string | null;
}) {
  if (sprints.length === 0) return null;

  return (
    <section className="workspace-panel">
      <h3>Sprint Progress</h3>
      <ul className="analysis-card-list">
        {sprints.map((sprint) => (
          <li
            key={sprint.sprintId}
            className="analysis-card"
            style={
              sprint.sprintId === activeSprintId
                ? { borderColor: 'var(--accent, #2f6feb)' }
                : undefined
            }
          >
            <div className="analysis-card-header">
              <strong>
                Sprint {sprint.number} — {sprint.title}
              </strong>
              <StatusText status={sprint.status} />
            </div>
            <p className="approval-panel-meta">{sprint.objective}</p>
            <ProgressBar percent={sprint.progressPercent} />
            <p className="approval-panel-meta">
              {sprint.passedTasks} / {sprint.totalTasks} Tasks passed ({sprint.progressPercent}%)
              {sprint.runningTasks > 0 && ` · ${sprint.runningTasks} running`}
              {sprint.reviewingTasks > 0 && ` · ${sprint.reviewingTasks} reviewing`}
              {sprint.failedTasks > 0 && ` · ${sprint.failedTasks} failed`}
              {sprint.blockedTasks > 0 && ` · ${sprint.blockedTasks} blocked`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
