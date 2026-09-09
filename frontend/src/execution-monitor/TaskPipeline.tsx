import type { TaskPipelineEntry } from './types';
import { shortSha } from './format';

// Sequential visualization of every Task in the active Sprint (item 39) —
// status is communicated by text/icon, never color alone (item 40/110).
const ICON: Record<string, string> = {
  PASSED: '✓',
  RUNNING: '▶',
  REVIEWING: '▶',
  FAILED: '✕',
  BLOCKED: '✕',
  PENDING: '○',
  READY: '○',
};

export function TaskPipeline({
  tasks,
  currentTaskId,
}: {
  tasks: TaskPipelineEntry[];
  currentTaskId: string | null;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="workspace-panel">
      <h3>Task Pipeline</h3>
      <ul className="analysis-card-list">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="analysis-card"
            style={
              task.id === currentTaskId
                ? { borderColor: 'var(--accent)', borderWidth: 2 }
                : undefined
            }
          >
            <div className="analysis-card-header">
              <strong>
                <span aria-hidden="true">{ICON[task.status] ?? '○'}</span> {task.key} —{' '}
                {task.title}
                {task.id === currentTaskId && (
                  <span className="approval-panel-meta"> (current)</span>
                )}
              </strong>
              <span className="approval-panel-meta">{task.status}</span>
            </div>
            {task.commitSha && (
              <p className="approval-panel-meta">
                Local commit <code>{shortSha(task.commitSha)}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
