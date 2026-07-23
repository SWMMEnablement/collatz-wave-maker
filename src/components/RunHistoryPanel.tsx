import { Button } from "@/components/ui/button";
import { ThresholdsPanel } from "./ThresholdsPanel";
import {
  toneForContinuity,
  toneForFlooded,
  toneForSurcharge,
  type Thresholds,
} from "@/lib/thresholds";
import type { RunHistoryEntry } from "@/lib/runHistory";

interface Props {
  entries: RunHistoryEntry[];
  onReopen: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  hasStoredResult: (id: string) => boolean;
  thresholds: Thresholds;
  setThresholds: (t: Thresholds) => void;
  resetThresholds: () => void;
}

export function RunHistoryPanel({
  entries,
  onReopen,
  onRemove,
  onClear,
  hasStoredResult,
  thresholds,
  setThresholds,
  resetThresholds,
}: Props) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <ThresholdsPanel value={thresholds} onChange={setThresholds} onReset={resetThresholds} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Run history</h3>
          <p className="text-xs text-muted-foreground">
            Persisted in your browser · {entries.length} run{entries.length === 1 ? "" : "s"} ·
            click any row to re-open the results in the Engine tab.
          </p>
        </div>
        {entries.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear all
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No runs yet. Runs from the <span className="mx-1 font-mono text-primary">Engine</span>
          and <span className="mx-1 font-mono text-primary">Batch</span> tabs will appear here.
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-border bg-card">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">when</th>
                <th className="px-3 py-2">inputs</th>
                <th className="px-3 py-2 text-right">flow cont.</th>
                <th className="px-3 py-2 text-right">runoff cont.</th>
                <th className="px-3 py-2 text-right">flooded</th>
                <th className="px-3 py-2 text-right">surcharge</th>
                <th className="px-3 py-2 text-right">nodes/links</th>
                <th className="px-3 py-2 text-right">runtime</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const canReopen = hasStoredResult(e.id);
                return (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                        disabled={!canReopen}
                        onClick={() => onReopen(e.id)}
                        title={
                          canReopen
                            ? "Re-open this run's results in the Engine tab"
                            : "Full result not in memory (page reload) — summary metrics only"
                        }
                      >
                        {e.label}
                      </button>{" "}
                      <span className="text-muted-foreground">{e.inputVersion}</span>{" "}
                      <span className="text-[10px] uppercase text-accent">{e.meta.engine}</span>
                    </td>
                    <MetricCell tone={toneForContinuity(e.metrics.flowContinuityPct, thresholds, "flow")}>
                      {fmtPct(e.metrics.flowContinuityPct)}
                    </MetricCell>
                    <MetricCell tone={toneForContinuity(e.metrics.runoffContinuityPct, thresholds, "runoff")}>
                      {fmtPct(e.metrics.runoffContinuityPct)}
                    </MetricCell>
                    <MetricCell tone={toneForFlooded(e.metrics.floodedNodes, thresholds)}>
                      {e.metrics.floodedNodes}
                    </MetricCell>
                    <MetricCell tone={toneForSurcharge(e.metrics.maxSurchargeHours, thresholds)}>
                      {e.metrics.maxSurchargeHours != null
                        ? e.metrics.maxSurchargeHours.toFixed(2) + "h"
                        : "—"}
                    </MetricCell>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {e.meta.nodeCount}/{e.meta.conduitCount}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {(e.meta.durationMs / 1000).toFixed(2)}s
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => onRemove(e.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove from history"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(3) + "%";
}

function MetricCell({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "bad"
      ? "text-destructive font-semibold"
      : tone === "warn"
        ? "text-accent"
        : tone === "ok"
          ? "text-primary"
          : "text-muted-foreground";
  return <td className={`px-3 py-1.5 text-right ${cls}`}>{children}</td>;
}
