/**
 * Generic directed-graph cycle detection (3-color DFS). Used to reject a
 * plan whose task or sprint dependencies form a cycle — a real relational
 * graph is only useful to future orchestration ("find the next runnable
 * task") if it's actually a DAG.
 */
export function hasCycle(
  nodes: string[],
  edges: Map<string, string[]>,
): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n, WHITE]));
  let cyclic = false;

  function visit(node: string): void {
    if (cyclic) return;
    color.set(node, GRAY);
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next);
      if (state === GRAY) {
        cyclic = true;
        return;
      }
      if (state === WHITE) {
        visit(next);
      }
    }
    color.set(node, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node) === WHITE) {
      visit(node);
    }
  }

  return cyclic;
}
