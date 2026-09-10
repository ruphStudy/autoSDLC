import { Link } from 'react-router-dom';
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

// Completed-but-unreviewed / accepted / rejected next-action (item 110) —
// the acceptance decision is a human one, never inferred client-side, so
// this only ever links to the real Review page rather than guessing.
function AcceptanceNextAction({
  projectId,
  sprintId,
  sprintStatus,
  acceptance,
}: {
  projectId: string;
  sprintId: string;
  sprintStatus: string;
  acceptance: SprintProgressSummary['acceptance'];
}) {
  if (sprintStatus !== 'PASSED') return null;

  if (!acceptance || acceptance.status === 'READY_FOR_DECISION' || acceptance.status === 'FAILED') {
    return (
      <Link to={`/projects/${projectId}/sprints/${sprintId}/review`} className="stage-nav-link">
        {acceptance?.stale ? 'Review Sprint (stale — regenerate)' : 'Review Sprint'}
      </Link>
    );
  }
  if (acceptance.status === 'ACCEPTED') {
    return <span className="status-badge status-badge--success">Accepted</span>;
  }
  if (acceptance.status === 'REJECTED') {
    return (
      <Link to={`/projects/${projectId}/sprints/${sprintId}/review`} className="stage-nav-link">
        Needs Attention
      </Link>
    );
  }
  return (
    <Link to={`/projects/${projectId}/sprints/${sprintId}/review`} className="stage-nav-link">
      Review in progress…
    </Link>
  );
}

// Every Sprint in the current plan, not just the active one (item 90/104) —
// lets the user see what already completed and what is still ahead without
// leaving the Development page.
export function SprintProgressCard({
  projectId,
  sprints,
  activeSprintId,
}: {
  projectId: string;
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
            <AcceptanceNextAction
              projectId={projectId}
              sprintId={sprint.sprintId}
              sprintStatus={sprint.status}
              acceptance={sprint.acceptance}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
