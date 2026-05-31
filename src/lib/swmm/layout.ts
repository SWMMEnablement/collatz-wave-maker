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
  { value: "parity-grid", label: "Parity grid" },
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

function nodesByDepth(tree: CollatzTree): Map<number, number[]> {
  const byD = new Map<number, number[]>();
  for (const [n, d] of tree.depth) {
    if (!byD.has(d)) byD.set(d, []);
    byD.get(d)!.push(n);
  }
  for (const list of byD.values()) list.sort((a, b) => a - b);
  return byD;
}

// ---------- 1. Radial rings ----------

export function layoutRadial(tree: CollatzTree): Map<number, [number, number]> {
  const byDepth = nodesByDepth(tree);
  const coords = new Map<number, [number, number]>();
  for (const [d, list] of byDepth) {
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

  const placeSubtree = (
    n: number,
    aStart: number,
    aEnd: number,
    depthScale: number,
  ) => {
    const d = tree.depth.get(n) ?? 1;
    const r = d * depthScale;
    const a = (aStart + aEnd) / 2;
    coords.set(n, [r * Math.cos(a), r * Math.sin(a)]);
    const kids = children.get(n) ?? [];
    if (!kids.length) return;
    const totalW = kids.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const k of kids) {
      const w = weight.get(k) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      placeSubtree(k, cursor, cursor + span, depthScale);
      cursor += span;
    }
  };

  const place = (list: number[], aStart: number, aEnd: number, ds: number) => {
    const totalW = list.reduce((s, n) => s + (weight.get(n) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const root of list) {
      const w = weight.get(root) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      placeSubtree(root, cursor, cursor + span, ds);
      cursor += span;
    }
  };

  const roots = children.get(1) ?? [];
  const half = Math.ceil(roots.length / 2);
  const leftRoots = roots.slice(0, half);
  const rightRoots = roots.slice(half);
  const ds = 55;
  place(rightRoots, -Math.PI / 2, Math.PI / 2, ds);
  place(leftRoots, Math.PI / 2, (3 * Math.PI) / 2, ds);
  return coords;
}

// ---------- 3. Reingold–Tilford tidy tree ----------
// Simple Walker-style: assign each subtree a horizontal slot proportional to
// its leaf count, then center parents over their children. Root at top.

export function layoutReingoldTilford(
  tree: CollatzTree,
): Map<number, [number, number]> {
  const children = childrenMap(tree);
  const leaves = subtreeLeaves(children, 1);
  const coords = new Map<number, [number, number]>();
  const xStep = 28;
  const yStep = 60;

  const place = (n: number, xStart: number): number => {
    const d = tree.depth.get(n) ?? 0;
    const kids = children.get(n) ?? [];
    if (!kids.length) {
      coords.set(n, [xStart * xStep, d * yStep]);
      return xStart + 1;
    }
    let cursor = xStart;
    const firstX = cursor;
    for (const k of kids) cursor = place(k, cursor);
    const lastX = cursor - 1;
    const cx = ((firstX + lastX) / 2) * xStep;
    coords.set(n, [cx, d * yStep]);
    return cursor;
  };
  place(1, 0);

  // shift so root is at x=0
  const [rx] = coords.get(1) ?? [0, 0];
  for (const [n, [x, y]] of coords) coords.set(n, [x - rx, y]);
  // y inverted so root is on top -> outfall visually at top
  return coords;
}

// ---------- 4. Dendrogram: leaves aligned at max depth ----------

export function layoutDendrogram(
  tree: CollatzTree,
): Map<number, [number, number]> {
  const children = childrenMap(tree);
  const md = maxDepth(tree);
  const coords = new Map<number, [number, number]>();
  const xStep = 24;
  const yStep = 50;
  let leafCursor = 0;

  const place = (n: number): number => {
    const kids = children.get(n) ?? [];
    if (!kids.length) {
      const x = leafCursor++ * xStep;
      coords.set(n, [x, md * yStep]);
      return x;
    }
    const xs = kids.map(place);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const d = tree