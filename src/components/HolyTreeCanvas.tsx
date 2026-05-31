import { useEffect, useMemo, useRef, useState } from "react";
import type { CollatzTree } from "@/lib/collatz";

interface Props {
  tree: CollatzTree;
  coords: Map<number, [number, number]>;
}

export function HolyTreeCanvas({ tree, coords }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const base = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coords.values()) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = 40;
    const x = minX - pad;
    const y = minY - pad;
    const w = Math.max(1, maxX - minX) + pad * 2;
    const h = Math.max(1, maxY - minY) + pad * 2;
    let md = 0;
    for (const d of tree.depth.values()) if (d > md) md = d;
    return { x, y, w, h, maxDepth: md || 1 };
  }, [coords, tree]);

  // View = base viewBox transformed by zoom (scale) + pan (cx, cy = center)
  const [view, setView] = useState({
    cx: base.x + base.w / 2,
    cy: base.y + base.h / 2,
    scale: 1, // >1 = zoomed in
  });

  // Reset when base changes (new tree)
  useEffect(() => {
    setView({ cx: base.x + base.w / 2, cy: base.y + base.h / 2, scale: 1 });
  }, [base.x, base.y, base.w, base.h]);

  const vbW = base.w / view.scale;
  const vbH = base.h / view.scale;
  const vbX = view.cx - vbW / 2;
  const vbY = view.cy - vbH / 2;
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

  const clampScale = (s: number) => Math.min(40, Math.max(0.2, s));

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    setView((v) => {
      const newScale = clampScale(v.scale * factor);
      const f = v.scale / newScale; // ratio of new vb to old vb
      const oldW = base.w / v.scale;
      const oldH = base.h / v.scale;
      const newW = base.w / newScale;
      const newH = base.h / newScale;
      // Point under cursor in svg coords (old):
      const sx = v.cx - oldW / 2 + px * oldW;
      const sy = v.cy - oldH / 2 + py * oldH;
      // Keep that point under the cursor with new viewbox:
      const newCx = sx - (px - 0.5) * newW;
      const newCy = sy - (py - 0.5) * newH;
      void f;
      return { cx: newCx, cy: newCy, scale: newScale };
    });
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, factor);
  };

  // Wheel needs non-passive listener to preventDefault in some browsers
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX, e.clientY, factor);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.w, base.h]);

  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / rect.width) * vbW;
    const dy = ((e.clientY - d.y) / rect.height) * vbH;
    setView((v) => ({ ...v, cx: d.cx - dx, cy: d.cy - dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const zoomBy = (f: number) => {
    const svg = svgRef.current;
    if (!svg) {
      setView((v) => ({ ...v, scale: clampScale(v.scale * f) }));
      return;
    }
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, f);
  };

  const reset = () =>
    setView({ cx: base.x + base.w / 2, cy: base.y + base.h / 2, scale: 1 });

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-border bg-[#08060c]">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
        <rect x={base.x} y={base.y} width={base.w} height={base.h} fill="url(#bg)" />

        {/* Edges */}
        <g filter="url(#glow)">
          {Array.from(tree.edges).map(([from, to]) => {
            const a = coords.get(from);
            const b = coords.get(to);
            if (!a || !b) return null;
            const d = tree.depth.get(from) ?? 0;
            const t = d / base.maxDepth;
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
            const t = d / base.maxDepth;
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
      </svg>

      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        holy tree · {tree.nodes.size} nodes · depth {base.maxDepth} · {view.scale.toFixed(2)}×
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          onClick={() => zoomBy(1.4)}
          className="h-8 w-8 rounded border border-border bg-background/70 font-mono text-sm text-foreground backdrop-blur hover:bg-background"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomBy(1 / 1.4)}
          className="h-8 w-8 rounded border border-border bg-background/70 font-mono text-sm text-foreground backdrop-blur hover:bg-background"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={reset}
          className="h-8 w-8 rounded border border-border bg-background/70 font-mono text-[10px] text-foreground backdrop-blur hover:bg-background"
          aria-label="Reset view"
        >
          fit
        </button>
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
