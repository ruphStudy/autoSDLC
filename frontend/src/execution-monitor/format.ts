// Readable elapsed-duration formatting (item 59) — "42s" / "3m 18s" /
// "1h 04m". Never persisted server-side; always computed on the fly from
// timestamps the backend already returns.
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function formatElapsedSince(startedAt: string | null): string {
  if (!startedAt) return '—';
  return formatDuration(Date.now() - new Date(startedAt).getTime());
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : '—';
}
