import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

export function EngineRunner({ built }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  // pick a sensible set of nodes to chart: root + a handful of biggest
  const chartData = (() => {
    if (!result || result.series.length === 0) return { rows: [], keys: [] as number[] };
    const top = [...result.series]
      .sort(
        (a, b) =>
          Math.max(...b.depth) - Math.max(...a.depth),
      )
      .slice(0, 6);
    const keys = top.map((s) => s.node);
    const rows = result.times.map((t, i) => {
      const row: Record<string, number> = { t };
      for (const s of top) row["n" + s.node] = s.depth[i];
      return row;
    });
    return { rows, keys };
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
              {result.durationMs.toFixed(0)} ms
            </span>
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
                      label={{ value: "depth", angle: -90, position: "insideLeft" }}
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
                    {chartData.keys.map((n, i) => (
                      <Line
                        key={n}
                        type="monotone"
                        dataKey={"n" + n}
                        name={`node ${n}`}
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
