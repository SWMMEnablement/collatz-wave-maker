import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildInp, type InpOptions } from "@/lib/swmm/inp";
import { startEngine, type EngineResult, type EngineRunHandle } from "@/lib/swmm/engine";
import { parseRptSummary, type RptSummary } from "@/lib/swmm/rpt";
import {
  exceedsBad,
  toneForContinuity,
  toneForFlooded,
  toneForSurcharge,
  type Thresholds,
} from "@/lib/thresholds";
import { makeHistoryEntry, type RunHistoryEntry } from "@/lib/runHistory";

type RowStatus = "queued" | "running" | "done" | "error" | "stopped" | "cancelled";

interface BatchRow {
  n: number;
  status: RowStatus;
  metrics?: RptSummary;
  durationMs?: number;
  engine?: "wasm" | "stub";
  nodeCount?: number;
  conduitCount?: number;
  historyId?: string;
  error?: string;
  stopReasons?: string[];
}

interface Props {
  baseOpts: InpOptions;
  thresholds: Thresholds;
  onSaveHistory: (entry: RunHistoryEntry, result: EngineResult) => void;
  onReopen: (id: string) => void;
  hasStoredResult: (id: string) => boolean;
}

const DEFAULT_LIST = "10, 27, 100, 500, 1000";

export function BatchRunner({ baseOpts, thresholds, onSaveHistory, onReopen, hasStoredResult }: Props) {
  const [input, setInput] = useState(DEFAULT_LIST);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<{ i: number; total: number; pct: number } | null>(null);
  const cancelRef = useRef(false);
  const handleRef = useRef<EngineRunHandle | null>(null);

  const parseNs = (): number[] => {
    return Array.from(
      new Set(
        input
          .split(/[,\s]+/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n >= 2 && n <= 5000)
          .map((n) => Math.floor(n)),
      ),
    ).sort((a, b) => a - b);
  };

  const applyPreset = (label: string) => {
    if (label === "quick") setInput("10, 27, 100");
    else if (label === "wide") setInput("10, 27, 100, 500, 1000, 2000");
    else if (label === "stress") setInput("10, 100, 1000, 2500, 5000");
  };

  const runBatch = async () => {
    const ns = parseNs();
    if (ns.length === 0) return;
    setRunning(true);
    cancelRef.current = false;
    const initial: BatchRow[] = ns.map((n) => ({ n, status: "queued" }));
    setRows(initial);
    const working = [...initial];

    for (let i = 0; i < ns.length; i++) {
      if (cancelRef.current) {
        for (let j = i; j < ns.length; j++) working[j] = { ...working[j], status: "cancelled" };
        setRows([...working]);
        break;
      }
      working[i] = { ...working[i], status: "running" };
      setRows([...working]);
      setCurrent({ i: i + 1, total: ns.length, pct: 0 });

      const opts: InpOptions = { ...baseOpts, maxSeed: ns[i] };
      const built = buildInp(opts);
      try {
        const handle = startEngine(built, {
          onProgress: (pct) => setCurrent({ i: i + 1, total: ns.length, pct }),
        });
        handleRef.current = handle;
        const result = await handle.promise;
        handleRef.current = null;
        const metrics = parseRptSummary(result.rpt);
        const entry = makeHistoryEntry(opts, built, result, metrics);
        onSaveHistory(entry, result);
        working[i] = {
          n: ns[i],
          status: "done",
          metrics,
          durationMs: result.durationMs,
          engine: result.engine,
          nodeCount: built.nodeCount,
          conduitCount: built.conduitCount,
          historyId: entry.id,
        };
        setRows([...working]);

        if (thresholds.stopOnBad) {
          const check = exceedsBad(metrics, thresholds);
          if (check.bad) {
            working[i] = { ...working[i], stopReasons: check.reasons };
            for (let j = i + 1; j < ns.length; j++)
              working[j] = { ...working[j], status: "stopped" };
            setRows([...working]);
            break;
          }
        }
      } catch (e) {
        working[i] = { n: ns[i], status: "error", error: (e as Error).message };
        setRows([...working]);
        handleRef.current = null;
      }
    }

    setCurrent(null);
    setRunning(false);
  };

  const cancelBatch = () => {
    cancelRef.current = true;
    handleRef.current?.cancel();
    handleRef.current = null;
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="rounded-md border border-border bg-card/60 p-4">
        <h3 className="text-sm font-semibold">Batch runs across N values</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Uses the current form settings for every run and only varies{" "}
          <code className="font-mono">maxSeed (N)</code>. Each finished run is saved to the run
          history and can be re-opened in the Engine tab.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              N values (comma or space separated, 2..5000)
            </Label>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={DEFAULT_LIST}
              disabled={running}
            />
          </div>
          <div className="flex items-end gap-2">
            {!running ? (
              <Button onClick={runBatch} disabled={parseNs().length === 0}>
                Run batch ({parseNs().length})
              </Button>
            ) : (
              <Button variant="destructive" onClick={cancelBatch}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Presets:
          </span>
          {[
            { k: "quick", label: "Quick (3)" },
            { k: "wide", label: "Wide (6)" },
            { k: "stress", label: "Stress (5, up to 5000)" },
          ].map((p) => (
            <Button
              key={p.k}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={running}
              onClick={() => applyPreset(p.k)}
            >
              {p.label}
            </Button>
          ))}
          {current && (
            <div className="ml-auto flex items-center gap-2">
              <div className="relative h-2 w-48 overflow-hidden rounded bg-muted">
                <div
                  className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.max(2, current.pct)}%` }}
                />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                run {current.i}/{current.total} · {current.pct.toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto rounded-md border border-border bg-card">
        <table className="w-full font-mono text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">N</th>
              <th className="px-3 py-2">status</th>
              <th className="px-3 py-2 text-right">nodes</th>
              <th className="px-3 py-2 text-right">links</th>
              <th className="px-3 py-2 text-right">flow cont.</th>
              <th className="px-3 py-2 text-right">runoff cont.</th>
              <th className="px-3 py-2 text-right">flooded</th>
              <th className="px-3 py-2 text-right">surcharge</th>
              <th className="px-3 py-2 text-right">runtime</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={10}>
                  No batch yet. Enter N values above and click <em>Run batch</em>.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const fm = r.metrics;
                return (
                  <tr key={idx} className="border-b border-border/50 hover:bg-muted/30 align-top">
                    <td className="px-3 py-1.5 text-primary">{r.n}</td>
                    <td className="px-3 py-1.5">
                      <StatusPill status={r.status} />
                      {r.stopReasons && (
                        <div className="mt-1 max-w-[24rem] text-[10px] leading-snug text-destructive">
                          stopped: {r.stopReasons.join("; ")}
                        </div>
                      )}
                      {r.error && (
                        <div className="mt-1 max-w-[24rem] text-[10px] leading-snug text-destructive">
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {r.nodeCount ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {r.conduitCount ?? "—"}
                    </td>
                    <ToneCell tone={fm ? toneForContinuity(fm.flowContinuityPct, thresholds, "flow") : "muted"}>
                      {fm ? fmtPct(fm.flowContinuityPct) : "—"}
                    </ToneCell>
                    <ToneCell tone={fm ? toneForContinuity(fm.runoffContinuityPct, thresholds, "runoff") : "muted"}>
                      {fm ? fmtPct(fm.runoffContinuityPct) : "—"}
                    </ToneCell>
                    <ToneCell tone={fm ? toneForFlooded(fm.floodedNodes.length, thresholds) : "muted"}>
                      {fm ? fm.floodedNodes.length : "—"}
                    </ToneCell>
                    <ToneCell tone={fm ? toneForSurcharge(fm.maxSurchargeHours, thresholds) : "muted"}>
                      {fm?.maxSurchargeHours != null ? fm.maxSurchargeHours.toFixed(2) + "h" : "—"}
                    </ToneCell>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {r.durationMs != null ? (r.durationMs / 1000).toFixed(2) + "s" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.historyId && hasStoredResult(r.historyId) ? (
                        <button
                          type="button"
                          onClick={() => onReopen(r.historyId!)}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          open
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(3) + "%";
}

function StatusPill({ status }: { status: RowStatus }) {
  const map: Record<RowStatus, string> = {
    queued: "border-border bg-muted/40 text-muted-foreground",
    running: "border-primary/40 bg-primary/10 text-primary",
    done: "border-primary/40 bg-primary/10 text-primary",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
    stopped: "border-destructive/50 bg-destructive/10 text-destructive",
    cancelled: "border-border bg-muted/40 text-muted-foreground",
  };
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${map[status]}`}
    >
      {status}
    </span>
  );
}

function ToneCell({
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
