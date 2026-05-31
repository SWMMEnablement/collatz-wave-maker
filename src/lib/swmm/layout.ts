import type { CollatzTree } from "../collatz";

export type LayoutMode =
  | "radial"
  | "symmetric"
  | "reingold-tilford"
  | "dendrogram"
  | "sunburst"
  | "force"
  | "sugiyama"
  | "spiral"
  | "arc"
  | "stopping-time"
  | "parity-grid";

export const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: "symmetric", label: "Symmetric bloom" },
  { value: "radial", label: "Radial rings" },
  { value: "reingold-tilford", label: "Reingold–Tilford tidy tree" },
  { value: "dendrogram", label: "Dendrogram (leaves aligned)" },
  { value: "sunburst", label: "Sunburst (area = subtree)" },
  { value: "force", label: "Force-directed" },
  { value: "sugiyama", label: "Sugiyama layered DAG" },
  { value: "spiral", label: "Ulam spiral" },
  { value: "arc", label: "Arc diagram" },
  { value: "stopping-time", label: "Stopping-time isochrone" },
  { value: "parity-grid", label: "Parity-colored grid" },
];

// ---------- helpers ----------

function childrenMap(tree: CollatzTree): Map<number, number[]> {
  const ch = new Map<number, number[]>();
  for (const [a, b] of tree.edges) {
    if (!ch.has(b)) ch.set(b, []);
    ch.get(b)!.push(a);
  }
  for (const list of ch.values()) list.sort((a, b) => a - b);
  return ch;
}

function subtreeLeaves(
  ch: Map<number, number[]>,
  root: number,
): Map<number, number> {
  const w = new Map<number, number>();
  const visit = (n: number): number => {
    const kids = ch.get(n) ?? [];
    if (!kids.length) {
      w.set(n, 1);
      return 1;
    }
    let s = 0;
    for (const k of kids) s += visit(k);
    w.set(n, s);
    return s;
  };
  visit(root);
  return w;
}

function maxDepth(tree: CollatzTree): number {
  let m = 0;
  for (const d of tree.depth.values()) if (d > m) m = d;
  return m || 1;
}

// stopping time = depth (BFS distance from 1 along reverse edges)
// already stored in tree.depth

// ---------- 1. Radial rings ----------

export function layoutRadial(tree: CollatzTree): Map<number, [number, number]> {
  const byDepth = new Map<number, number[]>();
  for (const [n, d] of tree.depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n);
  }
  const coords = new Map<number, [number, number]>();
  for (const [d, list] of byDepth) {
    list.sort((a, b) => a - b);
    if (d === 0) {
      coords.set(list[0], [0, 0]);
      continue;
    }
    const r = d * 50;
    const step = (2 * Math.PI) / list.length;
    list.forEach((n, i) => {
      const a = i * step;
      coords.set(n, [r * Math.cos(a), r * Math.sin(a)]);
    });
  }
  return coords;
}

// ---------- 2. Symmetric bloom ----------

export function layoutSymmetric(
  tree: CollatzTree,
): Map<number, [number, number]> {
  const children = childrenMap(tree);
  const weight = subtreeLeaves(children, 1);

  const coords = new Map<number, [number, number]>();
  coords.set(1, [0, 0]);

  const roots = children.get(1) ?? [];
  const half = Math.ceil(roots.length / 2);
  const leftRoots = roots.slice(0, half);
  const rightRoots = roots.slice(half);

  const placeSubtree = (
    n: number