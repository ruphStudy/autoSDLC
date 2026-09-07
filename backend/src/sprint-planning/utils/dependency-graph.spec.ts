import { hasCycle } from './dependency-graph';

describe('hasCycle', () => {
  it('returns false for an empty graph', () => {
    expect(hasCycle([], new Map())).toBe(false);
  });

  it('returns false for a simple DAG', () => {
    const edges = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
    ]);
    expect(hasCycle(['A', 'B', 'C'], edges)).toBe(false);
  });

  it('returns false for a DAG with a diamond shape', () => {
    const edges = new Map([
      ['A', ['B', 'C']],
      ['B', ['D']],
      ['C', ['D']],
      ['D', []],
    ]);
    expect(hasCycle(['A', 'B', 'C', 'D'], edges)).toBe(false);
  });

  it('detects a direct two-node cycle', () => {
    const edges = new Map([
      ['A', ['B']],
      ['B', ['A']],
    ]);
    expect(hasCycle(['A', 'B'], edges)).toBe(true);
  });

  it('detects a self-loop', () => {
    const edges = new Map([['A', ['A']]]);
    expect(hasCycle(['A'], edges)).toBe(true);
  });

  it('detects a longer indirect cycle', () => {
    const edges = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', ['A']],
    ]);
    expect(hasCycle(['A', 'B', 'C'], edges)).toBe(true);
  });

  it('handles disconnected components correctly', () => {
    const edges = new Map([
      ['A', ['B']],
      ['B', []],
      ['C', ['D']],
      ['D', ['C']],
    ]);
    expect(hasCycle(['A', 'B', 'C', 'D'], edges)).toBe(true);
  });
});
