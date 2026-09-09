import type { CurrentTaskSummary } from './types';
import { StatusText } from './PhaseBadge';
import { formatDuration } from './format';

export function CurrentTaskCard({ task }: { task: CurrentTaskSummary | null }) {
  if (!task) return null;

  return (
    <section className="workspace-panel">
      <div className="job-card-header">
        <h3>
          {task.key} — {task.title}
        </h3>
        <StatusText status={task.status} />
      </div>
      <p className="approval-panel-meta">
        {task.executionAttempt != null && `Attempt ${task.executionAttempt}`}
        {task.executionStatus && ` · ${task.executionStatus.replace(/_/g, ' ')}`}
        {task.instructionVersion != null && ` · Instruction v${task.instructionVersion}`}
      </p>
      <p className="approval-panel-meta">
        {task.changedFileCount} file{task.changedFileCount === 1 ? '' : 's'} changed
        {task.durationMs != null && ` · ${formatDuration(task.durationMs)}`}
      </p>
    </section>
  );
}
