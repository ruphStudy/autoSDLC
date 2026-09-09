import { useState } from 'react';
import { executionMonitorApi } from '../api/execution-monitor.api';
import type { EventScope, ExecutionTimelineEvent } from './types';
import { formatDateTime } from './format';

const SEVERITY_TONE: Record<string, string> = {
  INFO: 'neutral',
  SUCCESS: 'success',
  WARNING: 'paused',
  ERROR: 'danger',
};

const FILTERS: Array<{ label: string; scope: EventScope | 'ALL' | 'ERROR' }> = [
  { label: 'All', scope: 'ALL' },
  { label: 'Sprint', scope: 'SPRINT' },
  { label: 'Tasks', scope: 'TASK' },
  { label: 'Agent', scope: 'AGENT' },
  { label: 'Validation', scope: 'VALIDATION' },
  { label: 'Git', scope: 'GIT' },
  { label: 'Errors', scope: 'ERROR' },
];

// Purely a read view over synthesized events (item 9/75/76) — clicking
// "Show more" fetches an additional, larger page via the dedicated
// paginated endpoint rather than ever growing the lightweight polling
// response itself (item 80).
export function ExecutionTimeline({
  projectId,
  events,
}: {
  projectId: string;
  events: ExecutionTimelineEvent[];
}) {
  const [filter, setFilter] = useState<EventScope | 'ALL' | 'ERROR'>('ALL');
  const [extra, setExtra] = useState<ExecutionTimelineEvent[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const source = extra ?? events;
  const filtered =
    filter === 'ALL'
      ? source
      : filter === 'ERROR'
        ? source.filter((e) => e.severity === 'ERROR')
        : source.filter((e) => e.scope === filter);

  const handleShowMore = async () => {
    setLoadingMore(true);
    try {
      const page = await executionMonitorApi.getTimeline(projectId, { limit: 100 });
      setExtra(page.events);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="workspace-panel">
      <h3>Timeline</h3>
      <div className="project-detail-actions" style={{ marginBottom: 8 }}>
        {FILTERS.map((f) => (
          <button
            key={f.scope}
            type="button"
            className={filter === f.scope ? undefined : 'secondary'}
            onClick={() => setFilter(f.scope)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="analysis-empty-section">No events yet.</p>
      ) : (
        <ul className="analysis-card-list">
          {filtered.map((event) => (
            <li key={event.id} className="analysis-card">
              <div className="analysis-card-header">
                <strong>{event.title}</strong>
                <span
                  className={`status-badge status-badge--${SEVERITY_TONE[event.severity] ?? 'neutral'}`}
                >
                  {event.scope}
                </span>
              </div>
              <p className="approval-panel-meta">
                {formatDateTime(event.timestamp)}
                {event.taskKey && ` · ${event.taskKey}`}
              </p>
              {event.description && <p className="approval-panel-meta">{event.description}</p>}
            </li>
          ))}
        </ul>
      )}

      {!extra && (
        <button type="button" className="secondary" onClick={handleShowMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more history'}
        </button>
      )}
    </section>
  );
}
