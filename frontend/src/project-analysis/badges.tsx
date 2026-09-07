import type { ImportanceLevel, MoscowPriority } from './types';

// Reuses the same pill styling as the project StatusBadge (`.status-badge`,
// `.status-badge--<tone>` in index.css) so priority/severity pills look
// consistent with project status without introducing new CSS.
type Tone = 'neutral' | 'progress' | 'success' | 'danger' | 'paused';

function Pill({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}

const MOSCOW_META: Record<MoscowPriority, { label: string; tone: Tone }> = {
  must_have: { label: 'Must have', tone: 'danger' },
  should_have: { label: 'Should have', tone: 'paused' },
  could_have: { label: 'Could have', tone: 'neutral' },
};

export function PriorityBadge({ priority }: { priority: MoscowPriority }) {
  const meta = MOSCOW_META[priority];
  return <Pill tone={meta.tone} label={meta.label} />;
}

const IMPORTANCE_META: Record<ImportanceLevel, { label: string; tone: Tone }> = {
  high: { label: 'High', tone: 'danger' },
  medium: { label: 'Medium', tone: 'paused' },
  low: { label: 'Low', tone: 'neutral' },
};

export function ImportanceBadge({ level }: { level: ImportanceLevel }) {
  const meta = IMPORTANCE_META[level];
  return <Pill tone={meta.tone} label={meta.label} />;
}
