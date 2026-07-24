import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  toneForContinuity,
  toneForFlooded,
  toneForSurcharge,
  type Thresholds,
} from "@/lib/thresholds";
import type { RunHistoryEntry } from "@/lib/runHistory";
import { buildInp, defaultOptions, type BuildResult, type InpOptions } from "@/lib/swmm/inp";

interface Props {
  entries: RunHistoryEntry[];
  thresholds: Thresholds;
  onReopen: (id: string) => void;
  hasStoredResult: (id: string) => boolean;
}

const SELECTION_KEY = "collatz-swmm.compare.selection.v1";

function loadSelection(): { a: string; b: string } {
  if (typeof window === "undefined") return { a: "", b: "" };
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY);
    if (!raw) return { a: "", b: "" };
    const p = JSON.parse(raw);
    return { a: typeof p?.a === "string" ? p.a : "", b: typeof p?.b === "string" ? p.b : "" };
  } catch {
    return { a: "", b: "" };
  }
}

export function ComparePanel({ entries, thresholds, onReopen, hasStoredResult }: Props) {
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate persisted selection once, then reconcile against current entries.
  useEffect(() => {
    const s = loadSelection();
    setAId(s.a);
    setBId(s.b);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const has = (id: string) => !!id && entries.some((e) => e.id === id);
    setAId((prev) => {
      if (has(prev)) return prev;
      return entries[0]?.id ?? "";
    });
    setBId((prev) => {
      if (has(prev) && prev !== (entries[0]?.id ?? "")) return prev;
      const alt = entries.find((e) => e.id !== (aId || entries[0]?.id));
      return alt?.id ?? "";
    });
    // aId intentionally omitted — we only want to auto-heal when entries change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SELECTION_KEY, JSON.stringify({ a: aId, b: bId }));
    } catch {
      /* ignore quota */
    }
  }, [aId, bId, hydrated]);

  const a = entries.find((e) => e.id === aId);
  const b = entries.find((e) => e.id === bId);


  const nodeDiff = useMemo(() => {
    const aFl = new Set(a?.metrics.floodedNodeIds ?? []);
    const bFl = new Set(b?.metrics.floodedNodeIds ?? []);
    const aSu = new Set(a?.metrics.surchargedNodeIds ?? []);
    const bSu = new Set(b?.metrics.surchargedNodeIds ?? []);
    const flooded = {
      onlyA: [...aFl].filter((x) => !bFl.has(x)).sort(),
      onlyB: [...bFl].filter((x) => !aFl.has(x)).sort(),
      both: [...aFl].filter((x) => bFl.has(x)).sort(),
    };
    const surcharged = {
      onlyA: [...aSu].filter((x) => !bSu.has(x)).sort(),
      onlyB: [...bSu].filter((x) => !aSu.has(x)).sort(),
      both: [...aSu].filter((x) => bSu.has(x)).sort(),
    };
    return { flooded, surcharged };
  }, [a, b]);

  if (entries.length < 2) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Need at least two runs in history to compare. Run more simulations from the
        <span className="mx-1 font-mono text-primary">Engine</span> or
        <span className="mx-1 font-mono text-primary">Batch</span> tab.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="rounded-md border border-border bg-card/60 p-4">
        <h3 className="text-sm font-semibold">Compare two runs</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Highlights the delta in key metrics and the set difference of flooded /
          surcharged nodes between two runs from history.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <RunPicker label="Run A" value={aId} onChange={setAId} entries={entries} exclude={bId} />
          <RunPicker label="Run B" value={bId} onChange={setBId} entries={entries} exclude={aId} />
        </div>
      </div>

      {a && b ? (
        <>
          <div className="overflow-auto rounded-md border border-border bg-card">
            <table className="w-full font-mono text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">metric</th>
                  <th className="px-3 py-2 text-right">Run A</th>
                  <th className="px-3 py-2 text-right">Run B</th>
                  <th className="px-3 py-2 text-right">Δ (B − A)</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow
                  label="flow continuity %"
                  aVal={a.metrics.flowContinuityPct}
                  bVal={b.metrics.flowContinuityPct}
                  aTone={toneForContinuity(a.metrics.flowContinuityPct, thresholds, "flow")}
                  bTone={toneForContinuity(b.metrics.flowContinuityPct, thresholds, "flow")}
                  fmt={fmtPct}
                  betterLower
                  absolute
                />
                <MetricRow
                  label="runoff continuity %"
                  aVal={a.metrics.runoffContinuityPct}
                  bVal={b.metrics.runoffContinuityPct}
                  aTone={toneForContinuity(a.metrics.runoffContinuityPct, thresholds, "runoff")}
                  bTone={toneForContinuity(b.metrics.runoffContinuityPct, thresholds, "runoff")}
                  fmt={fmtPct}
                  betterLower
                  absolute
                />
                <MetricRow
                  label="flooded nodes"
                  aVal={a.metrics.floodedNodes}
                  bVal={b.metrics.floodedNodes}
                  aTone={toneForFlooded(a.metrics.floodedNodes, thresholds)}
                  bTone={toneForFlooded(b.metrics.floodedNodes, thresholds)}
                  fmt={(v) => (v == null ? "—" : String(v))}
                  betterLower
                />
                <MetricRow
                  label="surcharged nodes"
                  aVal={a.metrics.surchargedNodes}
                  bVal={b.metrics.surchargedNodes}
                  aTone="muted"
                  bTone="muted"
                  fmt={(v) => (v == null ? "—" : String(v))}
                  betterLower
                />
                <MetricRow
                  label="max surcharge (h)"
                  aVal={a.metrics.maxSurchargeHours}
                  bVal={b.metrics.maxSurchargeHours}
                  aTone={toneForSurcharge(a.metrics.maxSurchargeHours, thresholds)}
                  bTone={toneForSurcharge(b.metrics.maxSurchargeHours, thresholds)}
                  fmt={(v) => (v == null ? "—" : v.toFixed(2))}
                  betterLower
                />
                <MetricRow
                  label="analysis errors"
                  aVal={a.metrics.analysisErrors}
                  bVal={b.metrics.analysisErrors}
                  aTone={a.metrics.analysisErrors > 0 ? "bad" : "muted"}
                  bTone={b.metrics.analysisErrors > 0 ? "bad" : "muted"}
                  fmt={(v) => (v == null ? "—" : String(v))}
                  betterLower
                />
                <MetricRow
                  label="nodes"
                  aVal={a.meta.nodeCount}
                  bVal={b.meta.nodeCount}
                  aTone="muted"
                  bTone="muted"
                  fmt={(v) => (v == null ? "—" : String(v))}
                />
                <MetricRow
                  label="conduits"
                  aVal={a.meta.conduitCount}
                  bVal={b.meta.conduitCount}
                  aTone="muted"
                  bTone="muted"
                  fmt={(v) => (v == null ? "—" : String(v))}
                />
                <MetricRow
                  label="runtime (s)"
                  aVal={a.meta.durationMs / 1000}
                  bVal={b.meta.durationMs / 1000}
                  aTone="muted"
                  bTone="muted"
                  fmt={(v) => (v == null ? "—" : v.toFixed(2))}
                  betterLower
                />
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <NodeSetPanel
              title="Flooded nodes"
              a={a}
              b={b}
              diff={nodeDiff.flooded}
              onReopen={onReopen}
              hasStoredResult={hasStoredResult}
            />
            <NodeSetPanel
              title="Surcharged nodes"
              a={a}
              b={b}
              diff={nodeDiff.surcharged}
              onReopen={onReopen}
              hasStoredResult={hasStoredResult}
            />
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Pick two different runs above to compare.
        </div>
      )}
    </div>
  );
}

function RunPicker({
  label,
  value,
  onChange,
  entries,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  entries: RunHistoryEntry[];
  exclude: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— select —</option>
        {entries.map((e) => (
          <option key={e.id} value={e.id} disabled={e.id === exclude}>
            {new Date(e.timestamp).toLocaleString()} · {e.label} · {e.inputVersion}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricRow({
  label,
  aVal,
  bVal,
  aTone,
  bTone,
  fmt,
  betterLower,
  absolute,
}: {
  label: string;
  aVal: number | null | undefined;
  bVal: number | null | undefined;
  aTone: "ok" | "warn" | "bad" | "muted";
  bTone: "ok" | "warn" | "bad" | "muted";
  fmt: (v: number | null | undefined) => string;
  betterLower?: boolean;
  absolute?: boolean;
}) {
  const hasBoth = aVal != null && bVal != null;
  const rawDelta = hasBoth ? (bVal as number) - (aVal as number) : null;
  const compareDelta = hasBoth
    ? absolute
      ? Math.abs(bVal as number) - Math.abs(aVal as number)
      : (rawDelta as number)
    : null;
  let deltaTone: "ok" | "bad" | "muted" = "muted";
  if (compareDelta != null && Math.abs(compareDelta) > 1e-9 && betterLower) {
    deltaTone = compareDelta < 0 ? "ok" : "bad";
  }
  return (
    <tr className="border-b border-border/50">
      <td className="px-3 py-1.5 text-muted-foreground">{label}</td>
      <td className={`px-3 py-1.5 text-right ${toneCls(aTone)}`}>{fmt(aVal)}</td>
      <td className={`px-3 py-1.5 text-right ${toneCls(bTone)}`}>{fmt(bVal)}</td>
      <td className={`px-3 py-1.5 text-right ${toneCls(deltaTone)}`}>
        {rawDelta == null
          ? "—"
          : (rawDelta > 0 ? "+" : "") + fmt(rawDelta).replace(/^\+?/, "")}
      </td>
    </tr>
  );
}

function NodeSetPanel({
  title,
  a,
  b,
  diff,
  onReopen,
  hasStoredResult,
}: {
  title: string;
  a: RunHistoryEntry;
  b: RunHistoryEntry;
  diff: { onlyA: string[]; onlyB: string[]; both: string[] };
  onReopen: (id: string) => void;
  hasStoredResult: (id: string) => boolean;
}) {
  const total = diff.onlyA.length + diff.onlyB.length + diff.both.length;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {total} unique
        </span>
      </div>
      {total === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No {title.toLowerCase()} in either run.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 text-xs">
          <NodeSetGroup
            label={`Only in A (${a.label})`}
            tone="bad"
            ids={diff.onlyA}
            onOpen={hasStoredResult(a.id) ? () => onReopen(a.id) : undefined}
          />
          <NodeSetGroup
            label={`Only in B (${b.label})`}
            tone="bad"
            ids={diff.onlyB}
            onOpen={hasStoredResult(b.id) ? () => onReopen(b.id) : undefined}
          />
          <NodeSetGroup label="In both runs" tone="muted" ids={diff.both} />
        </div>
      )}
    </div>
  );
}

function NodeSetGroup({
  label,
  tone,
  ids,
  onOpen,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "muted";
  ids: string[];
  onOpen?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${toneCls(tone)}`}>
          {label} · {ids.length}
        </span>
        {onOpen && ids.length > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onOpen}>
            open run
          </Button>
        )}
      </div>
      {ids.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">—</p>
      ) : (
        <div className="mt-1 flex max-h-32 flex-wrap gap-1 overflow-auto">
          {ids.map((id) => (
            <span
              key={id}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${chipCls(tone)}`}
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(3) + "%";
}

function toneCls(tone: "ok" | "warn" | "bad" | "muted"): string {
  return tone === "bad"
    ? "text-destructive font-semibold"
    : tone === "warn"
      ? "text-accent"
      : tone === "ok"
        ? "text-primary"
        : "text-muted-foreground";
}

function chipCls(tone: "ok" | "warn" | "bad" | "muted"): string {
  return tone === "bad"
    ? "border-destructive/50 bg-destructive/10 text-destructive"
    : tone === "warn"
      ? "border-accent/50 bg-accent/10 text-accent"
      : tone === "ok"
        ? "border-primary/40 bg-primary/10 text-primary"
        : "border-border bg-muted/40 text-muted-foreground";
}
