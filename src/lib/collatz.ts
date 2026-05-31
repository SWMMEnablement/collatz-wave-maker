export function nextCollatz(n: number): number {
  return n % 2 === 0 ? n / 2 : 3 * n + 1;
}

export function sequence(seed: number): number[] {
  const out: number[] = [seed];
  let n = seed;
  while (n !== 1) {
    n = nextCollatz(n);
    out.push(n);
    if (out.length > 100000) break;
  }
  return out;
}

export interface CollatzTree {
  nodes: Set<number>;
  edges: Map<number, number>; // n -> next(n)
  depth: Map<number, number>; // distance from 1
}

export function buildTree(maxSeed: number): CollatzTree {
  const nodes = new Set<number>([1]);
  const edges = new Map<number, number>();
  for (let s = 2; s <= maxSeed; s++) {
    let n = s;
    while (n !== 1 && !edges.has(n)) {
      const nx = nextCollatz(n);
      nodes.add(n);
      nodes.add(nx);
      edges.set(n, nx);
      n = nx;
    }
  }
  // BFS depth from 1 over reverse edges
  const rev = new Map<number, number[]>();
  for (const [a, b] of edges) {
    if (!rev.has(b)) rev.set(b, []);
    rev.get(b)!.push(a);
  }
  const depth = new Map<number, number>();
  depth.set(1, 0);
  const queue: number[] = [1];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const child of rev.get(cur) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }
  return { nodes, edges, depth };
}
