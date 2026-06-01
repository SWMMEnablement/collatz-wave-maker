import { useState } from "react";
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
import { runEngine, type EngineResult } from "@/lib/swmm/engine";
import type { BuildResult } from "@/lib/swmm/inp";

interface Props {
  built: BuildResult;
}

type Metric = "depth" | "inflow" | "linkflow" | "system";

export function EngineRunner({ built }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("depth");

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await runEngine(built);
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const downloadRpt = () => {
    if (!result) return;
    const blob = new Blob([result.rpt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "swmm5_report.rpt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Build chart series. Plot ALL nodes/links (no top-N cap), sorted by peak.
  const chartData = (() => {
    if (!result || result.times.length === 0)
      return { rows: [] as Record<string, number>[], keys: [] as string[], labels: [] as string[], yLabel: "" };
    let entries: { key: string; label: string; values: number[] }[] = [];
    if (metric === "linkflow") {
      entries = [...result.links]
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
      entries = [...result.series]
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
        <Button onClick={run} disabled={running} size="lg">
          {running ? "Running…" : "Run SWMM5"}
        </Button>
        {result && (
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
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={downloadRpt}>
              Download .rpt
            </Button>
          </>
        )}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>

      {!result ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Click <span className="mx-1 font-mono text-primary">Run SWMM5</span> to
          execute the engine on the generated .inp. If a real{" "}
          <code className="font-mono">/wasm/swmm5.js</code> +{" "}
          <code className="font-mono">/wasm/swmm5.wasm</code> is present it will
          be used; otherwise a stub engine produces a synthetic report and time
          series so the UI is fully functional.
        </div>
      ) : (
        <Tabs defaultValue="graphics" className="flex flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="graphics">Graphics</TabsTrigger>
            <TabsTrigger value="rpt">RPT text</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>

          <TabsContent value="graphics" className="mt-3 flex-1">
            {chartData.rows.length === 0 ? (
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
                    <Legend wrapperStyle={{ fontSize: 11 }} />
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
