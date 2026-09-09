import type { ExecutionPhase } from './types';

// One shared tone map for every phase/status badge on the dashboard (item
// 41) — reuses the same `.status-badge--*` CSS classes every other panel
// in the app already uses, so Task/Sprint/AgentJob/Validation colors never
// diverge from each other.
const PHASE_META: Record<ExecutionPhase, { label: string; tone: string }> = {
  IDLE: { label: 'Idle', tone: 'neutral' },
  QUEUED: { label: 'Queued', tone: 'neutral' },
  PREPARING: { label: 'Preparing', tone: 'progress' },
  GENERATING_INSTRUCTION: { label: 'Preparing instructions', tone: 'progress' },
  CODING: { label: 'Coding', tone: 'progress' },
  CAPTURING_CHANGES: { label: 'Capturing changes', tone: 'progress' },
  VALIDATING: { label: 'Validating', tone: 'progress' },
  COMMITTING: { label: 'Committing', tone: 'progress' },
  PAUSED: { label: 'Paused', tone: 'paused' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function PhaseBadge({ phase }: { phase: ExecutionPhase }) {
  const meta = PHASE_META[phase] ?? { label: phase, tone: 'neutral' };
  return <span className={`status-badge status-badge--${meta.tone}`}>{meta.label}</span>;
}

// A generic badge for raw domain statuses (Task/AgentJob/ValidationRun
// statuses etc.) that don't go through the phase resolver — same CSS
// tones, just a plain label/tone pair supplied by the caller.
const GENERIC_TONE: Record<string, string> = {
  PENDING: 'neutral',
  READY: 'neutral',
  QUEUED: 'neutral',
  RUNNING: 'progress',
  REVIEWING: 'progress',
  PASSED: 'success',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  BLOCKED: 'danger',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
  AGENT_COMPLETED: 'progress',
  READY_FOR_VALIDATION: 'progress',
};

export function StatusText({ status }: { status: string }) {
  const tone = GENERIC_TONE[status] ?? 'neutral';
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
