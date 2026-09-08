import { computeBackoffSeconds } from './backoff';

describe('computeBackoffSeconds', () => {
  it('increases exponentially with attempt count', () => {
    expect(computeBackoffSeconds(1, 5, 300)).toBe(5);
    expect(computeBackoffSeconds(2, 5, 300)).toBe(10);
    expect(computeBackoffSeconds(3, 5, 300)).toBe(20);
    expect(computeBackoffSeconds(4, 5, 300)).toBe(40);
  });

  it('caps at the configured maximum', () => {
    expect(computeBackoffSeconds(10, 5, 300)).toBe(300);
  });

  it('never goes below the base delay for the first attempt', () => {
    expect(computeBackoffSeconds(1, 5, 300)).toBe(5);
  });

  it('is deterministic (no jitter) for the same inputs', () => {
    const a = computeBackoffSeconds(3, 5, 300);
    const b = computeBackoffSeconds(3, 5, 300);
    expect(a).toBe(b);
  });
});
