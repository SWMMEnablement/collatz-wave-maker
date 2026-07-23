import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { startEngine, type EngineResult, type EngineRunHandle } from "@/lib/swmm/engine";
import type { BuildResult, InpOptions } from "@/lib/swmm/inp";

interface Props {
  built: BuildResult;
  opts: InpOptions;
  selectedNodes?: Set<number> | null;
  result?: EngineResult | null;
  onResult?: (r: EngineResult | null) => void;
}

type Metric = "depth" | "inflow" | "linkflow" | "system";

export function EngineRunner({ built, opts, selectedNodes, result: resultProp, onResult }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef<EngineRunHandle | null>(null);
  const [internalResult, setInternalResult] = useState<EngineResult | null>(null);
  const result = resultProp !== undefined ? resultProp : internalResult;
  const setResult = (r: EngineResult | null) => {
    setInternalResult(r);
    onResult?.(r);
  };
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("depth");

  const run = () => {
    setRunning(true);
    setErr(null);
    setProgress(0);
    setElapsedMs(0);
    const start = performance.now();
    const tick = window.setInterval(() => setElapsedMs(performance.now() - start), 200);
    const handle = startEngine(built, {
      onProgress: (pct) => setProgress(pct),
    });
    handleRef.current = handle;
    handle.promise
      .then((r) => setResult(r))
      .catch((e) => setErr((e as Error).message))
      .finally(() => {
        window.clearInterval(tick);
        handleRef.current = null;
        setRunning(false);
      });
  };

  const cancel = () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setRunning(false);
    setErr("cancelled");
  };

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadRpt = () => {
    if (!result) return;
    triggerDownload(new Blob([result.rpt], { type: "text/plain" }), "swmm5_report.rpt");
  };
  const downloadOut = () => {
    if (!result?.out) return;
    const outBuf: Uint8Array = result.out;
    // Copy the underlying bytes into a fresh Uint8Array so the Blob owns
    // ArrayBuffer, not the possibly-shared/backing SharedArrayBuffer view.
    const copy = new Uint8Array(outBuf.byteLength);
    copy.set(outBuf);
    triggerDownload(new Blob([copy.buffer], { type: "application/octet-stream" }), "swmm5_output.out");
  };
  const downloadSummary = () => {
    if (!result) return;
    const cap = built.inverts;
    const rows = result.series.map((s) => {
      let mx = 0;
      for (const d of s.depth) if (d > mx) mx = d;
      const invert = cap.get(s.node) ?? 0;
      const maxHGL = invert + mx;
      const capacityHead = invert + opts.maxDepth;
      const excess = Math.max(0, mx - opts.maxDepth);
      const status: "normal" | "surcharge" | "flooding" =
        mx >= opts.maxDepth * 1.02
          ? "flooding"
          : mx >= opts.maxDepth * 0.98
            ? "surcharge"
            : "normal";
      return {
        node: s.node,
        invert: +invert.toFixed(3),
        maxDepth: +mx.toFixed(3),
        maxHGL: +maxHGL.toFixed(3),
        capacityHead: +capacityHead.toFixed(3),
        excessDepth: +excess.toFixed(3),
        status,
      };
    });
    const summary = {
      engine: result.engine,
      durationMs: result.durationMs,
      steps: result.times.length,
      pipeCapacity: opts.maxDepth,
      totals: {
        surcharge: rows.filter((r) => r.status === "surcharge").length,
        flooding: rows.filter((r) => r.status === "flooding").length,
      },
      nodes: rows,
    };
    triggerDownload(
      new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }),
      "swmm5_summary.json",
    );
  };

  // Per-node results table (post-run panel).
  const nodeRows = useMemo(() => {
    if (!result) return [];
    return result.series
      .map((s) => {
        let mx = 0;
        for (const d of s.depth) if (d > mx) mx = d;
        const invert = built.inverts.get(s.node) ?? 0;
        const capacityHead = invert + opts.maxDepth;
        const status: "normal" | "surcharge" | "flooding" =
          mx >= opts.maxDepth * 1.02
            ? "flooding"
            : mx >= opts.maxDepth * 0.98
              ? "surcharge"
              : "normal";
        return {
          node: s.node,
          invert,
          maxDepth: mx,
          maxHGL: invert + mx,
          capacityHead,
          excess: Math.max(0, mx - opts.maxDepth),
          status,
        };
      })
      .sort((a, b) => b.excess - a.excess || b.maxDepth - a.maxDepth);
  }, [result, built]);


  // Build chart series. Plot ALL nodes/links (no top-N cap), sorted by peak.
  const chartData = (() => {
    if (!result || result.times.length === 0)
      return { rows: [] as Record<string, number>[], keys: [] as string[], labels: [] as string[], yLabel: "" };
    let entries: { key: string; label: string; values: number[] }[] = [];
    if (metric === "linkflow") {
      const linkList = selectedNodes && selectedNodes.size > 0
        ? result.links.filter((l) => selectedNodes.has(l.from) || selectedNodes.has(l.to))
        : result.links;
      entries = [...linkList]
        .map((l) => ({
          key: l.id,
          label: `${l.id} (${l.from}→${l.to})`,
          values: l.flow,
        }))
        .sort((a, b) => Math.max(...b.values) - Math.max(...a.values));
    } else if (metric === "system") {
      const sys = result.system;
      const candidates: { key: keyof typeof sys; label: string }[] = [
        { key: "totalInflow", label: "Total inflow" },
        { key: "outflow", label: "Outfall flow" },
        { key: "flooding", label: "Flooding" },
        { key: "storage", label: "Storage" },
        { key: "runoff", label: "Runoff" },
        { key: "dwflow", label: "Dry-weather flow" },
        { key: "rainfall", label: "Rainfall" },
      ];
      entries = candidates
        .map((c) => ({ key: c.key as string, label: c.label, values: sys[c.key] ?? [] }))
        .filter((e) => e.values.length > 0 && Math.max(...e.values) > 0);
      if (entries.length === 0) {
        // show totalInflow even if zero so chart isn't empty
        entries = [{ key: "totalInflow", label: "Total inflow", values: sys.totalInflow }];
      }
    } else {
      const get = (s: { depth: number[]; inflow: number[] }) =>
        metric === "depth" ? s.depth : s.inflow;
      const nodeList = selectedNodes && selectedNodes.size > 0
        ? result.series.filter((s) => selectedNodes.has(s.node))
        : result.series;
      entries = [...nodeList]
        .map((s) => ({
          key: "n" + s.node,
          label: `node ${s.node}`,
          values: get(s),
        }))
        .sort((a, b) => Math.max(...b.values) - Math.max(...a.values));
    }
    const rows = result.times.map((t, i) => {
      const row: Record<string, number> = { t };
      for (const e of entries) row[e.key] = e.values[i] ?? 0;
      return row;
    });
    const yLabel =
      metric === "depth"
        ? "depth"
        : metric === "inflow"
          ? "node inflow"
          : metric === "linkflow"
            ? "link flow"
            : "system flow";
    return { rows, keys: entries.map((e) => e.key), labels: entries.map((e) => e.label), yLabel };
  })();

  const palette = [
    "hsl(var(--primary))",
    "#e85d3a",
    "#2dd4a8",
    "#c9a84c",
    "#9b72cf",
    "#5cbdb9",
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {!running ? (
          <Button onClick={run} size="lg">Run SWMM5</Button>
        ) : (
          <Button onClick={cancel} size="lg" variant="destructive">Cancel</Button>
        )}
        {running && (
          <div className="flex min-w-[240px] flex-1 items-center gap-2">
            <div className="relative h-2 flex-1 overflow-hidden rounded bg-muted">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-150"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {progress > 0 ? `${progress.toFixed(0)}%` : "warming up…"} · {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}
        {result && !running && (
          <>
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              engine: <span className="text-primary">{result.engine}</span> ·{" "}
              {result.durationMs.toFixed(0)} ms · {result.times.length} steps ·{" "}
              {result.links.length} links
            </span>
            <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="depth">Node depth</SelectItem>
                <SelectItem value="inflow">Node inflow</SelectItem>
                <SelectItem value="linkflow">Link flow (hydrograph)</SelectItem>
                <SelectItem value="system">System (totals)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={downloadRpt}>
              .rpt
            </Button>
            <Button variant="outline" size="sm" onClick={downloadOut} disabled={!result.out}>
              .out
            </Button>
            <Button variant="outline" size="sm" onClick={downloadSummary}>
              summary.json
            </Button>
            {selectedNodes && selectedNodes.size > 0 && (
              <span className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                filtered: {selectedNodes.size} node{selectedNodes.size === 1 ? "" : "s"} selected on diagram
              </span>
            )}
          </>
        )}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {!result ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-8">
          <div className="max-w-md space-y-2 text-center text-sm leading-relaxed text-muted-foreground">
            <p>
              Click <span className="font-mono text-primary">Run SWMM5</span> to
              execute the engine on the generated .inp.
            </p>
            <p className="text-xs">
              Uses the real wasm at{" "}
              <code className="font-mono">/wasm/swmm5.js</code> when present,
              otherwise falls back to a stub engine that produces a synthetic
              report and time series.
            </p>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="graphics" className="flex flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="graphics">Graphics</TabsTrigger>
            <TabsTrigger value="rpt">RPT text</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>

          <TabsContent value="graphics" className="mt-3 flex-1">
            {!selectedNodes || selectedNodes.size === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <p>Select an area on the diagram to view graphs.</p>
                <p className="text-xs">
                  Shift-drag on the canvas, or click{" "}
                  <span className="font-mono text-primary">select area</span> then drag.
                </p>
              </div>
            ) : chartData.rows.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No time series in result (real wasm reported summary only).
              </div>
            ) : (
              <div className="h-full w-full rounded-md border border-border bg-card p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="t"
                      label={{ value: "minutes", position: "insideBottom", offset: -4 }}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <YAxis
                      label={{ value: chartData.yLabel, angle: -90, position: "insideLeft" }}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: 12,
                      }}
                    />
                    {chartData.keys.length <= 12 && (
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    )}
                    {chartData.keys.map((k, i) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        name={chartData.labels?.[i] ?? k}
                        stroke={palette[i % palette.length]}
                        dot={false}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </TabsContent>

          <TabsContent value="rpt" className="mt-3 flex-1 overflow-auto">
            <pre className="h-full overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed">
              {result.rpt}
            </pre>
          </TabsContent>

          <TabsContent value="log" className="mt-3 flex-1 overflow-auto">
            <pre className="h-full overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs">
              {result.log || "(no log)"}
            </pre>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
