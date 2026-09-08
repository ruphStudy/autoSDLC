// Deterministic exponential backoff: base * 2^(attempt-1), capped. No
// jitter — deterministic behavior is more valuable than smoothing thundering
// herds at Sprint 8's scale, and it keeps retry-delay tests reproducible.
export function computeBackoffSeconds(
  attemptCount: number,
  baseSeconds: number,
  maxSeconds: number,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = baseSeconds * Math.pow(2, exponent);
  return Math.min(raw, maxSeconds);
}
