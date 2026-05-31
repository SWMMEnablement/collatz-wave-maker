import type { CollatzTree } from "../collatz";

export type LayoutMode = "radial" | "symmetric";

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

/**
 * Symmetric bloom layout: mirror the tree left/right around node 1.
 * Each subtree rooted at a depth-1 child gets an angular wedge; subtrees
 * are split into two halves and reflected across the vertical axis to
 * evoke the bilateral symmetry in the reference image.
 */
export function layoutSymmetric(
  tree: CollatzTree,
): Map<number, [number, number]> {
  // Reverse adjacency: parent -> children
  const children = new Map<number, number[]>();
  for (const [a, b] of tree.edges) {
    if (!children.has(b)) children.set(b, []);
    children.get(b)!.push(a);
  }
  for (const list of children.values()) list.sort((a, b) => a - b);

  // Subtree leaf counts (weight for angular allocation)
  const weight = new Map<number, number>();
  const computeWeight = (n: number): number => {
    const kids = children.get(n) ?? [];
    if (kids.length === 0) {
      weight.set(n, 1);
      return 1;
    }
    let w = 0;
    for (const k of kids) w += computeWeight(k);
    weight.set(n, w);
    return w;
  };
  computeWeight(1);

  const coords = new Map<number, [number, number]>();
  coords.set(1, [0, 0]);

  const roots = children.get(1) ?? [];
  const half = Math.ceil(roots.length / 2);
  const leftRoots = roots.slice(0, half);
  const rightRoots = roots.slice(half);

  // Angular spans: left side covers [PI/2, 3PI/2], right covers [-PI/2, PI/2]
  // (i.e. left = pointing left, right = pointing right). Upward = -y in SVG.
  const place = (
    list: number[],
    angleStart: number,
    angleEnd: number,
    depthScale: number,
  ) => {
    const totalW = list.reduce((s, n) => s + (weight.get(n) ?? 1), 0) || 1;
    let cursor = angleStart;
    for (const root of list) {
      const w = weight.get(root) ?? 1;
      const span = ((angleEnd - angleStart) * w) / totalW;
      placeSubtree(root, cursor, cursor + span, depthScale);
      cursor += span;
    }
  };

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
    if (kids.length === 0) return;
    const totalW = kids.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
    let cursor = aStart;
    for (const k of kids) {
      const w = weight.get(k) ?? 1;
      const span = ((aEnd - aStart) * w) / totalW;
      placeSubtree(k, cursor, cursor + span, depthScale);
      cursor += span;
    }
  };

  const depthScale = 55;
  // Right half-plane: angles around 0 (cos>0)
  place(rightRoots, -Math.PI / 2, Math.PI / 2, depthScale);
  // Left half-plane: angles around PI (cos<0)
  place(leftRoots, Math.PI / 2, (3 * Math.PI) / 2, depthScale);

  return coords;
}

export function layoutFor(
  tree: CollatzTree,
  mode: LayoutMode,
): Map<number, [number, number]> {
  return mode === "symmetric" ? layoutSymmetric(tree) : layoutRadial(tree);
}
