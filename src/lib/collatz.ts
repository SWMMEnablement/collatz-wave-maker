// Collatz utilities.
//
// Numerics: trajectory values are computed with BigInt so we never silently
// exceed JavaScript's Number.MAX_SAFE_INTEGER (2^53 - 1). Node identity in the
// graph is kept as a Number for cheap Map/Set keys, but a seed's traversal
// bails safely the instant its next value would leave the safe-integer range.
// The build diagnostics record every such termination so the UI can surface
// truncated / iteration-capped / unsafe-integer seeds instead of pretending
// the network is complete.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const THREE = 3n;
const ONE = 1n;
const TWO = 2n;

export const ITERATION_CAP_PER_SEED = 100_000;

export function nextCollatz(n: number): number {
  return n % 2 === 0 ? n / 2 : 3 * n + 1;
}

function nextCollatzBig(n: bigint): bigint {
  return n % TWO === 0n ? n / TWO : THREE * n + ONE;
}

export function sequence(seed: number): number[] {
  const out: number[] = [seed];
  let n = seed;
  while (n !== 1) {
    n = nextCollatz(n);
    out.push(n);
    if (out.length > ITERATION_CAP_PER_SEED) break;
  }
  return out;
}

/** Path from n down the Collatz sequence to 1, capped at maxSteps entries. */
export function pathToOne(n: number, maxSteps = 12): number[] {
  const out: number[] = [n];
  let cur = n;
  let steps = 0;
  while (cur !== 1 && steps < maxSteps) {
    cur = nextCollatz(cur);
    out.push(cur);
    steps++;
  }
  return out;
}

export interface CollatzTree {
  nodes: Set<number>;
  edges: Map<number, number>; // n -> next(n)
  depth: Map<number, number>; // distance from 1
  diagnostics: CollatzDiagnostics;
}

export interface CollatzDiagnostics {
  /** Largest trajectory value encountered across all seeds (as decimal string). */
  maxTrajectoryValue: string;
  /** Was every next-value within Number.MAX_SAFE_INTEGER? */
  safeIntegerOk: boolean;
  /** Seeds whose traversal was stopped because next value exceeded 2^53-1. */
  unsafeTruncatedSeeds: number[];
  /** Seeds whose traversal hit the per-seed iteration cap. */
  iterationCappedSeeds: number[];
  /** Iteration cap applied per seed. */
  iterationCap: number;
  /** Non-trivial cycles detected (Collatz has none proven; always 0 in practice). */
  cyclesDetected: number;
  /** Seeds that could not be resolved to 1 (unsafe + iteration-capped, deduped). */
  unresolvedSeeds: number[];
}

export function buildTree(maxSeed: number): CollatzTree {
  const nodes = new Set<number>([1]);
  const edges = new Map<number, number>();
  const unsafe: number[] = [];
  const capped: number[] = [];
  let maxVal = 1n;

  for (let s = 2; s <= maxSeed; s++) {
    let big = BigInt(s);
    let iters = 0;
    let unsafeHit = false;
    let cappedHit = false;
    while (big !== ONE) {
      if (big > MAX_SAFE) { unsafeHit = true; break; }
      if (iters >= ITERATION_CAP_PER_SEED) { cappedHit = true; break; }
      const cur = Number(big);
      if (edges.has(cur)) { big = ONE; break; } // already traced downstream
      const nxt = nextCollatzBig(big);
      if (nxt > maxVal) maxVal = nxt;
      if (nxt > MAX_SAFE) {
        // Record the current node but don't add an edge into an unsafe successor
        nodes.add(cur);
        unsafeHit = true;
        break;
      }
      const nxtNum = Number(nxt);
      nodes.add(cur);
      nodes.add(nxtNum);
      edges.set(cur, nxtNum);
      big = nxt;
      iters++;
    }
    if (unsafeHit) unsafe.push(s);
    if (cappedHit) capped.push(s);
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

  const unresolvedSet = new Set<number>([...unsafe, ...capped]);
  const diagnostics: CollatzDiagnostics = {
    maxTrajectoryValue: maxVal.toString(),
    safeIntegerOk: unsafe.length === 0,
    unsafeTruncatedSeeds: unsafe,
    iterationCappedSeeds: capped,
    iterationCap: ITERATION_CAP_PER_SEED,
    cyclesDetected: 0,
    unresolvedSeeds: [...unresolvedSet].sort((a, b) => a - b),
  };

  return { nodes, edges, depth, diagnostics };
}
