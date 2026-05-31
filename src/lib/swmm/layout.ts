import type { CollatzTree } from "../collatz";

export type LayoutMode =
  | "radial" | "symmetric" | "reingold-tilford" | "dendrogram"
  | "sunburst" | "force" | "sugiyama" | "spiral" | "arc"
  | "stopping-time" | "parity-grid";

export const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: "symmetric", label: "Symmetric bloom" },
  { value: "radial", label: "Radial rings" },
  { value: "reingold-tilford", label: "Reingold-Tilford tidy tree" },
  { value: "dendrogram", label: "Dendrogram (leaves aligned)" },
  { value: "sunburst", label: "Sunburst (area = subtree)" },
  { value: "force", label: "Force-directed" },
  { value: "sugiyama", label: "Sugiyama layered DAG" },
  { value: "spiral", label: "Ulam spiral" },
  { value: "arc", label: "Arc diagram" },
  { value: "stopping-time", label: "Stopping-time isochrone" },
  { value: "parity-grid", label: "Parity grid" },
];

type Coords = Map<number, [number, number]>;

function childrenMap(tree: CollatzTree): Map<number, number[]> {
  const ch = new Map<number, number[]>();
  for (const [a, b] of tree.edges) {
    if (!ch.has(b)) ch.set(b, []);
    ch.get(b)!.push(a);
  }
  for (const list of ch.values()) list.sort((a, b) => a - b);
  return ch;
}

function subtreeLeaves(ch: Map<number, number[]>, root: number): Map<number, number> {
  const w = new Map<number, number>();
  const visit = (n: number): number => {
    const kids = ch.get(n) ?? [];
    if (!kids.length) { w.set(n, 1); return 1; }
    let s = 0;
    for (const k of kids) s += visit(k);
    w.set(n, s); return s;
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

// 1. Radial rings
export function layoutRadial(tree: CollatzTree): Coords {
  const byDepth = nodesByDepth(tree);
  const coords: Coords = new Map();
  for (const [d, list] of byDepth) {
    if (d === 0) { coords.set(list[0], [0, 0]); continue; }
    const r = d * 50;
    const step = (2 * Math.PI) / list.length;
    list.forEach((n, i) => {
      const a = i * step;
      coords.set(n, [r * Math.cos(a), r * Math.sin(a)]);
    });
  }
  return coords;
}

// 2. Symmetric bloom
export function layoutSymmetric(tree: CollatzTree): Coords {
  const children = childrenMap(tree);
  const weight = subtreeLeaves(children, 1);
  const coords: Coords = new Map();
  coords.set(1, [0, 0]);
  const ds = 55;
  const placeSubtree = (n: number, aStart: number, aEnd: number) => {
    const d = tree.depth.get(n) ?? 1;
    const r = d * ds;
    const a = (aStart + aEnd) / 2;
    coords.set(n, [r * Math.cos(a), r * Math.sin(a)]);
    const kids = children.get(n) ?? [];
    if (!kids.length) return;
    const totalW = kids.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const k of kids) {
      const w = weight.get(k) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      placeSubtree(k, cursor, cursor + span);
      cursor += span;
    }
  };
  const place = (list: number[], aStart: number, aEnd: number) => {
    const totalW = list.reduce((s, n) => s + (weight.get(n) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const root of list) {
      const w = weight.get(root) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      placeSubtree(root, cursor, cursor + span);
      cursor += span;
    }
  };
  const roots = children.get(1) ?? [];
  const half = Math.ceil(roots.length / 2);
  place(roots.slice(half), -Math.PI / 2, Math.PI / 2);
  place(roots.slice(0, half), Math.PI / 2, (3 * Math.PI) / 2);
  return coords;
}

// 3. Reingold-Tilford tidy tree (root/outfall at y=0, leaves at bottom)
export function layoutReingoldTilford(tree: CollatzTree): Coords {
  const children = childrenMap(tree);
  const coords: Coords = new Map();
  const xStep = 28, yStep = 60;
  let leafCursor = 0;
  const place = (n: number): number => {
    const d = tree.depth.get(n) ?? 0;
    const kids = children.get(n) ?? [];
    if (!kids.length) {
      const x = leafCursor++ * xStep;
      coords.set(n, [x, d * yStep]);
      return x;
    }
    const xs = kids.map(place);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    coords.set(n, [cx, d * yStep]);
    return cx;
  };
  place(1);
  return coords;
}

// 4. Dendrogram: leaves aligned at deepest row
export function layoutDendrogram(tree: CollatzTree): Coords {
  const children = childrenMap(tree);
  const md = maxDepth(tree);
  const coords: Coords = new Map();
  const xStep = 24, yStep = 50;
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
    const d = tree.depth.get(n) ?? 0;
    coords.set(n, [cx, d * yStep]);
    return cx;
  };
  place(1);
  return coords;
}

// 5. Sunburst: angular wedge proportional to subtree leaf count
export function layoutSunburst(tree: CollatzTree): Coords {
  const children = childrenMap(tree);
  const weight = subtreeLeaves(children, 1);
  const coords: Coords = new Map();
  coords.set(1, [0, 0]);
  const ds = 55;
  const place = (n: number, aStart: number, aEnd: number) => {
    const d = tree.depth.get(n) ?? 0;
    const r = d * ds;
    const a = (aStart + aEnd) / 2;
    coords.set(n, [r * Math.cos(a), r * Math.sin(a)]);
    const kids = children.get(n) ?? [];
    if (!kids.length) return;
    const totalW = kids.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const k of kids) {
      const w = weight.get(k) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      place(k, cursor, cursor + span);
      cursor += span;
    }
  };
  place(1, 0, 2 * Math.PI);
  // Override root at center
  coords.set(1, [0, 0]);
  // Place top-level children using full circle weighting
  const roots = children.get(1) ?? [];
  const totalW = roots.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
  let cursor = 0;
  for (const k of roots) {
    const w = weight.get(k) ?? 1;
    const span = (2 * Math.PI * w) / totalW;
    place(k, cursor, cursor + span);
    cursor += span;
  }
  return coords;
}

// 6. Force-directed (Fruchterman-Reingold, fixed iterations)
export function layoutForce(tree: CollatzTree): Coords {
  const ids = Array.from(tree.nodes);
  const idx = new Map<number, number>();
  ids.forEach((n, i) => idx.set(n, i));
  const N = ids.length;
  const W = Math.sqrt(N) * 60;
  const pos = new Float64Array(N * 2);
  // seed with radial as starting positions
  const seed = layoutRadial(tree);
  ids.forEach((n, i) => {
    const [x, y] = seed.get(n) ?? [0, 0];
    pos[2 * i] = x; pos[2 * i + 1] = y;
  });
  const edges: [number, number][] = [];
  for (const [a, b] of tree.edges) edges.push([idx.get(a)!, idx.get(b)!]);
  const k = W / Math.sqrt(N);
  const iter = Math.min(120, 30 + Math.floor(800 / Math.sqrt(N)));
  let t = W / 10;
  const cool = t / (iter + 1);
  const disp = new Float64Array(N * 2);
  for (let it = 0; it < iter; it++) {
    disp.fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = pos[2 * i] - pos[2 * j];
        const dy = pos[2 * i + 1] - pos[2 * j + 1];
        const dist = Math.hypot(dx, dy) || 0.01;
        const f = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist;
        disp[2 * i] += ux * f; disp[2 * i + 1] += uy * f;
        disp[2 * j] -= ux * f; disp[2 * j + 1] -= uy * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[2 * a] - pos[2 * b];
      const dy = pos[2 * a + 1] - pos[2 * b + 1];
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = (dist * dist) / k;
      const ux = dx / dist, uy = dy / dist;
      disp[2 * a] -= ux * f; disp[2 * a + 1] -= uy * f;
      disp[2 * b] += ux * f; disp[2 * b + 1] += uy * f;
    }
    for (let i = 0; i < N; i++) {
      const dx = disp[2 * i], dy = disp[2 * i + 1];
      const d = Math.hypot(dx, dy) || 0.01;
      pos[2 * i] += (dx / d) * Math.min(d, t);
      pos[2 * i + 1] += (dy / d) * Math.min(d, t);
    }
    t = Math.max(0.1, t - cool);
  }
  // Pin node 1 to origin by translating
  const oneI = idx.get(1)!;
  const ox = pos[2 * oneI], oy = pos[2 * oneI + 1];
  const coords: Coords = new Map();
  ids.forEach((n, i) => coords.set(n, [pos[2 * i] - ox, pos[2 * i + 1] - oy]));
  return coords;
}

// 7. Sugiyama layered DAG (depth -> row, evenly spaced within row, root top)
export function layoutSugiyama(tree: CollatzTree): Coords {
  const byDepth = nodesByDepth(tree);
  const coords: Coords = new Map();
  const xStep = 32, yStep = 70;
  let widest = 0;
  for (const list of byDepth.values()) if (list.length > widest) widest = list.length;
  const W = widest * xStep;
  for (const [d, list] of byDepth) {
    const step = list.length > 1 ? W / (list.length - 1) : 0;
    const x0 = list.length > 