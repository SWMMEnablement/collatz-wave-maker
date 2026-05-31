import type { CollatzTree } from "../collatz";

export function layoutRadial(tree: CollatzTree): Map<number, [number, number]> {
  // Group nodes by depth; place each depth ring on a circle.
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
