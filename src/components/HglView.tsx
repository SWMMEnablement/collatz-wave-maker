import { useMemo, useState } from "react";
import type { CollatzTree } from "@/lib/collatz";
import type { InpOptions } from "@/lib/swmm/inp";

interface Props {
  tree: CollatzTree;
  inverts: Map<number, number>;
  opts: InpOptions;
}

/**
 * Hydraulic Grade Line view.
 * Nodes are ordered from highest invert (headwaters, deepest in Collatz tree)
 * down to the outfall (node 1). Plotted: ground (invert + maxDepth),
 * pipe crown (invert + diameter), invert, and a conceptual HGL estimated
 * from the cumulative upstream DWF inflow at each node.
 */
export function HglView({ tree, inverts, opts }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    // Count upstream subtree size for each node (drives accumulated DWF).
    const rev = new Map<number, number[]>();
    for (const [a, b] of tree.edges) {
      if (!rev.has(b)) rev.set(b, []);
      rev.get(b)!.push(a);
    }
    const upstreamCount = new Map<number, number>();
    const visit = (n: number): number => {
      if (upstreamCount.has(n)) return upstreamCount.get(n)!;
      let c = 1;
      for (const child of rev.get(n) ?? []) c += visit(child);
      upstreamCount.set(n, c);
      return c;
    };
    for (const n of tree.nodes) visit(n);

    const rows = Array.from(tree.nodes).map((n) => {
      const inv = inverts.get(n) ?? 0;
      const up = upstreamCount.get(n) ?? 1;
      // Conceptual HGL: rises with accumulated DWF, capped at ground.
      const qAccum = up * opts.dwfBaseflow;
      const headProxy = Math.min(
        opts.maxDepth,
        Math.log10(1 + qAccum) * (opts.diameter * 1.5),
      );
      return {
        n,
        invert: inv,
        crown: inv + opts.diameter,
        ground: inv + opts.maxDepth,
        hgl: inv + headProxy,
        upstream: up,
        q: qAccum,
        isOutfall: n === 1,
      };
    });
    rows.sort((a, b) => b.invert - a.invert || a.n - b.n);
    return rows;
  }, [tree, inverts, opts]);

  const W = 1000;
  const H = 520;
  const padL = 56;
  const padR = 24;
  const padT = 24;
  const padB = 48;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const minY = Math.min(...data.map((d) => d.invert));
  const maxY = Math.max(...data.map((d) => d.ground));
  const yRange = maxY - minY || 1;

  const x = (i: number) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - minY) / yRange) * innerH;

  const path = (key: "invert" | "crown" | "ground" | "hgl") =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(d[key]).toFixed(2)}`)
      .join(" ");

  const groundFill =
    `M${x(0).toFixed(2)},${y(data[0]?.ground ?? 0).toFixed(2)} ` +
    data
      .slice(1)
      .map((d, i) => `L${x(i + 1).toFixed(2)},${y(d.ground).toFixed(2)}`)
      .join(" ") +
    ` L${x(data.length - 1).toFixed(2)},${(padT + innerH).toFixed(2)}` +
    ` L${x(0).toFixed(2)},${(padT + innerH).toFixed(2)} Z`;

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = minY + (i / yTicks) * yRange;
    return { v, y: y(v) };
  });

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-border bg-[#08060c]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        <defs>
          <linearGradient id="ground-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.35 0.05 60)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.18 0.03 60)" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="hgl-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.18 230)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="oklch(0.55 0.16 250)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Y grid + labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={t.y}
              y2={t.y}
              stroke="oklch(0.3 0.02 280)"
              strokeDasharray="2 4"
              strokeOpacity="0.5"
            />
            <text
              x={padL - 8}
              y={t.y + 3}
              textAnchor="end"
              className="fill-muted-foreground font-mono"
              fontSize="10"
            >
              {t.v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Ground fill */}
        <path d={groundFill} fill="url(#ground-grad)" />

        {/* HGL area */}
        <path
          d={
            `M${x(0).toFixed(2)},${(padT + innerH).toFixed(2)} ` +
            data
              .map((d, i) => `L${x(i).toFixed(2)},${y(d.hgl).toFixed(2)}`)
              .join(" ") +
            ` L${x(data.length - 1).toFixed(2)},${(padT + innerH).toFixed(2)} Z`
          }
          fill="url(#hgl-grad)"
        />

        {/* Pipe invert line */}
        <path
          d={path("invert")}
          fill="none"
          stroke="oklch(0.7 0.05 60)"
          strokeWidth="1.6"
        />

        {/* Pipe crown line */}
        <path
          d={path("crown")}
          fill="none"
          stroke="oklch(0.6 0.03 60)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* HGL line */}
        <path
          d={path("hgl")}
          fill="none"
          stroke="oklch(0.78 0.2 230)"
          strokeWidth="2"
        />

        {/* Node markers */}
        {data.map((d, i) => (
          <circle
            key={d.n}
            cx={x(i).toFixed(2)}
            cy={y(d.invert).toFixed(2)}
            r={d.isOutfall ? 5 : 2.2}
            fill={d.isOutfall ? "oklch(0.82 0.18 65)" : "oklch(0.75 0.15 320)"}
            stroke="oklch(0.95 0.05 280)"
            strokeOpacity="0.4"
            strokeWidth="0.5"
            onMouseEnter={() => setHover(d.n)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* Axis labels */}
        <text
          x={padL}
          y={H - 12}
          className="fill-muted-foreground font-mono uppercase"
          fontSize="10"
        >
          highest invert →→ outfall (node 1)
        </text>
        <text
          x={12}
          y={padT + 12}
          className="fill-muted-foreground font-mono uppercase"
          fontSize="10"
        >
          elevation
        </text>
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        hgl · {data.length} nodes · dwf {opts.dwfBaseflow} {opts.flowUnits} / node
      </div>

      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
        <Legend swatch="oklch(0.35 0.05 60)" label="ground" />
        <Legend swatch="oklch(0.6 0.03 60)" label="pipe crown" dashed />
        <Legend swatch="oklch(0.7 0.05 60)" label="invert" />
        <Legend swatch="oklch(0.78 0.2 230)" label="hgl (∝ ΣDWF)" />
      </div>

      {hover != null && (() => {
        const d = data.find((r) => r.n === hover);
        if (!d) return null;
        return (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-border bg-background/85 px-2 py-1 font-mono text-xs text-foreground backdrop-blur">
            n=<span className="text-primary">{d.n}</span> · invert{" "}
            {d.invert.toFixed(2)} · crown {d.crown.toFixed(2)} · hgl{" "}
            {d.hgl.toFixed(2)} · ΣQ {d.q.toFixed(3)} {opts.flowUnits}
          </div>
        );
      })()}
    </div>
  );
}

function Legend({
  swatch,
  label,
  dashed,
}: {
  swatch: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="18" height="6">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke={swatch}
          strokeWidth="2"
          strokeDasharray={dashed ? "3 3" : undefined}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}
