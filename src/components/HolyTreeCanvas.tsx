import { useMemo, useState } from "react";
import type { CollatzTree } from "@/lib/collatz";

interface Props {
  tree: CollatzTree;
  coords: Map<number, [number, number]>;
}

export function HolyTreeCanvas({ tree, coords }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const { viewBox, maxDepth } = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coords.values()) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = 40;
    const w = Math.max(1, maxX - minX) + pad * 2;
    const h = Math.max(1, maxY - minY) + pad * 2;
    let md = 0;
    for (const d of tree.depth.values()) if (d > md) md = d;
    return {
      viewBox: `${minX - pad} ${minY - pad} ${w} ${h}`,
      maxDepth: md || 1,
    };
  }, [coords, tree]);

  const heavy = false;

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-border bg-[#08060c]">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="bg" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#1a0a2a" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#08060c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect
          x={viewBox.split(" ")[0]}
          y={viewBox.split(" ")[1]}
          width={viewBox.split(" ")[2]}
          height={viewBox.split(" ")[3]}
          fill="url(#bg)"
        />

        {/* Edges */}
        <g filter="url(#glow)">
          {Array.from(tree.edges).map(([from, to]) => {
            const a = coords.get(from);
            const b = coords.get(to);
            if (!a || !b) return null;
            const d = tree.depth.get(from) ?? 0;
            const t = d / maxDepth;
            // Trunk = bright magenta, tips = soft pink/violet
            const opacity = 0.85 - t * 0.55;
            const stroke = `hsl(${330 - t * 40}, 85%, ${55 + t * 10}%)`;
            const width = Math.max(0.4, 1.6 - t * 1.1);
            return (
              <line
                key={`${from}-${to}`}
                x1={+a[0].toFixed(2)}
                y1={+a[1].toFixed(2)}
                x2={+b[0].toFixed(2)}
                y2={+b[1].toFixed(2)}
                stroke={stroke}
                strokeOpacity={+opacity.toFixed(3)}
                strokeWidth={+width.toFixed(2)}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Nodes */}
        {!heavy && (
          <g>
            {Array.from(tree.nodes).map((n) => {
              const p = coords.get(n);
              if (!p) return null;
              if (n === 1) {
                return (
                  <circle
                    key={n}
                    cx={p[0]}
                    cy={p[1]}
                    r={10}
                    fill="oklch(0.82 0.18 65)"
                    stroke="oklch(0.95 0.05 65)"
                    strokeWidth={1.2}
                    filter="url(#glow)"
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              }
              const d = tree.depth.get(n) ?? 0;
              const t = d / maxDepth;
              const r = Math.max(2.2, 5 - t * 2.5);
              const fill = `hsl(${230 - t * 30}, 95%, ${65 + t * 15}%)`;
              return (
                <circle
                  key={n}
                  cx={+p[0].toFixed(2)}
                  cy={+p[1].toFixed(2)}
                  r={+r.toFixed(2)}
                  fill={fill}
                  fillOpacity={+(0.95 - t * 0.25).toFixed(3)}
                  stroke="hsl(280, 100%, 85%)"
                  strokeOpacity={+(0.4 - t * 0.25).toFixed(3)}
                  strokeWidth={0.4}
                  filter="url(#glow)"
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        holy tree · {tree.nodes.size} nodes · depth {maxDepth}
        {heavy && " · nodes hidden (>1500)"}
      </div>
      {hover != null && (
        <div className="pointer-events-none absolute right-3 top-3 rounded border border-border bg-background/80 px-2 py-1 font-mono text-xs text-foreground backdrop-blur">
          n = <span className="text-primary">{hover}</span> · depth{" "}
          {tree.depth.get(hover)}
        </div>
      )}
    </div>
  );
}
