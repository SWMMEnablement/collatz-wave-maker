import { useEffect, useMemo, useState } from "react";
import type { CollatzTree } from "@/lib/collatz";
import type { InpOptions } from "@/lib/swmm/inp";
import type { EngineResult } from "@/lib/swmm/engine";

interface Props {
  tree: CollatzTree;
  inverts: Map<number, number>;
  opts: InpOptions;
  engineResult?: EngineResult | null;
}

/**
 * Hydraulic Grade Line view.
 * Nodes are ordered from highest invert (headwaters, deepest in Collatz tree)
 * down to the outfall (node 1). When an EngineResult is provided, an
 * additional time slider is shown and HGL = invert + depth(t) from the engine
 * so surcharging is visible over the storm.
 */
export function HglView({ tree, inverts, opts, engineResult }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const hasEngine = !!engineResult && engineResult.times.length > 0;
  const [timeIdx, setTimeIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const activeIdx = hasEngine
    ? Math.min(timeIdx, engineResult!.times.length - 1)
    : 0;

  useEffect(() => {
    if (!playing || !hasEngine) return;
    const total = engineResult!.times.length;
    const id = window.setInterval(() => {
      setTimeIdx((i) => {
        const next = i + 1;
        if (next >= total) {
          setPlaying(false);
          return total - 1;
        }
        return next;
      });
    }, Math.max(30, 200 / speed));
    return () => window.clearInterval(id);
  }, [playing, hasEngine, engineResult, speed]);

  const depthByNode = useMemo(() => {
    const m = new Map<number, number>();
    if (!hasEngine) return m;
    for (const s of engineResult!.series) {
      m.set(s.node, s.depth[activeIdx] ?? 0);
    }
    return m;
  }, [engineResult, hasEngine, activeIdx]);

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
      const qAccum = up * opts.dwfBaseflow;
      let hgl: number;
      let surcharged = false;
      let flooded = false;
      if (hasEngine) {
        const d = depthByNode.get(n) ?? 0;
        hgl = inv + d;
        if (n !== 1) {
          if (d >= opts.maxDepth * 1.02) flooded = true;
          else if (d >= opts.maxDepth * 0.98) surcharged = true;
        }
      } else {
        // Fallback conceptual HGL from cumulative DWF.
        const headProxy = Math.min(
          opts.maxDepth,
          Math.log10(1 + qAccum) * (opts.diameter * 1.5),
        );
        hgl = inv + headProxy;
      }
      return {
        n,
        invert: inv,
        crown: inv + opts.diameter,
        ground: inv + opts.maxDepth,
        hgl,
        upstream: up,
        q: qAccum,
        isOutfall: n === 1,
        surcharged,
        flooded,
      };
    });

    rows.sort((a, b) => b.invert - a.invert || a.n - b.n);
    return rows;
  }, [tree, inverts, opts, hasEngine, depthByNode]);


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

        {/* Surcharge markers (amber) */}
        {hasEngine && data.filter((d) => d.surcharged).map((d) => {
          const i = data.indexOf(d);
          return (
            <circle
              key={"sc" + d.n}
              cx={x(i).toFixed(2)}
              cy={y(d.hgl).toFixed(2)}
              r={3.5}
              fill="oklch(0.82 0.18 65)"
              stroke="oklch(0.95 0.1 60)"
              strokeWidth="0.8"
            >
              <title>node {d.n} surcharged: depth {(d.hgl - d.invert).toFixed(2)} near {opts.maxDepth}</title>
            </circle>
          );
        })}

        {/* Flooded markers (bright red, larger + pulse ring) */}
        {hasEngine && data.filter((d) => d.flooded).map((d) => {
          const i = data.indexOf(d);
          return (
            <g key={"fl" + d.n}>
              <circle
                cx={x(i).toFixed(2)}
                cy={y(d.hgl).toFixed(2)}
                r={7}
                fill="none"
                stroke="oklch(0.72 0.22 25)"
                strokeWidth="1"
                strokeOpacity="0.6"
              />
              <circle
                cx={x(i).toFixed(2)}
                cy={y(d.hgl).toFixed(2)}
                r={4.5}
                fill="oklch(0.72 0.22 25)"
                stroke="oklch(0.98 0.05 20)"
                strokeWidth="1"
              >
                <title>node {d.n} FLOODED: depth {(d.hgl - d.invert).toFixed(2)} ≥ {opts.maxDepth}</title>
              </circle>
            </g>
          );
        })}


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
        hgl · {data.length} nodes ·{" "}
        {hasEngine
          ? `t = ${(engineResult!.times[activeIdx] ?? 0).toFixed(0)} min · engine=${engineResult!.engine}`
          : `dwf ${opts.dwfBaseflow} ${opts.flowUnits} / node (conceptual)`}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
        <Legend swatch="oklch(0.35 0.05 60)" label="ground" />
        <Legend swatch="oklch(0.6 0.03 60)" label="pipe crown" dashed />
        <Legend swatch="oklch(0.7 0.05 60)" label="invert" />
        <Legend swatch="oklch(0.78 0.2 230)" label={hasEngine ? "hgl (depth from engine)" : "hgl (∝ ΣDWF)"} />
        {hasEngine && <Legend swatch="oklch(0.82 0.18 65)" label="surcharged" />}
        {hasEngine && <Legend swatch="oklch(0.72 0.22 25)" label="flooded" />}
      </div>


      {hasEngine && (
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-md border border-border bg-background/85 px-3 py-2 backdrop-blur">
          <button
            onClick={() => {
              if (activeIdx >= engineResult!.times.length - 1) setTimeIdx(0);
              setPlaying((p) => !p);
            }}
            className="h-7 w-7 rounded border border-border bg-background font-mono text-xs text-foreground hover:bg-muted"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-7 rounded border border-border bg-background px-1 font-mono text-[10px] text-foreground"
            title="Playback speed"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
            <option value={8}>8×</option>
          </select>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            time
          </span>
          <input
            type="range"
            min={0}
            max={engineResult!.times.length - 1}
            step={1}
            value={activeIdx}
            onChange={(e) => {
              setPlaying(false);
              setTimeIdx(Number(e.target.value));
            }}
            className="flex-1 accent-[var(--color-primary)]"
          />
          <span className="font-mono text-[10px] text-primary">
            {(engineResult!.times[activeIdx] ?? 0).toFixed(0)} min
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            · {data.filter((d) => d.surcharged).length} surcharged
          </span>
        </div>
      )}

      {hover != null && (() => {
        const d = data.find((r) => r.n === hover);
        if (!d) return null;
        return (
          <div className="pointer-events-none absolute bottom-16 left-3 rounded border border-border bg-background/85 px-2 py-1 font-mono text-xs text-foreground backdrop-blur">
            n=<span className="text-primary">{d.n}</span> · invert{" "}
            {d.invert.toFixed(2)} · crown {d.crown.toFixed(2)} · hgl{" "}
            {d.hgl.toFixed(2)}
            {d.surcharged ? " · SURCHARGED" : ""}
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
