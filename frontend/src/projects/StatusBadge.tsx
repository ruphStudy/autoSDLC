import type { ProjectStatus } from './types';

type StatusTone = 'neutral' | 'progress' | 'success' | 'danger' | 'paused';

// Centralized so no other component hardcodes a status label or color.
// Extend this map — not scattered conditionals — when new statuses appear.
const STATUS_META: Record<ProjectStatus, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ANALYZING: { label: 'Analyzing', tone: 'progress' },
  ANALYSIS_READY: { label: 'Analysis ready', tone: 'progress' },
  PLANNING: { label: 'Planning', tone: 'progress' },
  PLAN_READY: { label: 'Plan ready', tone: 'progress' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'paused' },
  DEVELOPING: { label: 'Developing', tone: 'progress' },
  TESTING: { label: 'Testing', tone: 'progress' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  PAUSED: { label: 'Paused', tone: 'paused' },
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const meta = STATUS_META[status];
  return <span className={`status-badge status-badge--${meta.tone}`}>{meta.label}</span>;
}
