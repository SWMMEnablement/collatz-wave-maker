import { useEffect, useMemo, useRef, useState } from "react";
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

const IMPORTED_KEY = "collatz-swmm.compare.imported.v1";

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
  const [importedEntries, setImportedEntries] = useState<RunHistoryEntry[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate persisted selection + imported entries once.
  useEffect(() => {
    const s = loadSelection();
    setAId(s.a);
    setBId(s.b);
    try {
      const raw = window.localStorage.getItem(IMPORTED_KEY);
      if (raw) setImportedEntries(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const mergedEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: RunHistoryEntry[] = [];
    for (const e of [...importedEntries, ...entries]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [importedEntries, entries]);

  useEffect(() => {
    if (!hydrated) return;
    const has = (id: string) => !!id && mergedEntries.some((e) => e.id === id);
    setAId((prev) => {
      if (has(prev)) return prev;
      return mergedEntries[0]?.id ?? "";
    });
    setBId((prev) => {
      if (has(prev) && prev !== (mergedEntries[0]?.id ?? "")) return prev;
      const alt = mergedEntries.find((e) => e.id !== (aId || mergedEntries[0]?.id));
      return alt?.id ?? "";
    });
    // aId intentionally omitted — we only want to auto-heal when entries change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedEntries, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SELECTION_KEY, JSON.stringify({ a: aId, b: bId }));
    } catch {
      /* ignore quota */
    }
  }, [aId, bId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(IMPORTED_KEY, JSON.stringify(importedEntries));
    } catch {
      /* ignore */
    }
  }, [importedEntries, hydrated]);

  const a = mergedEntries.find((e) => e.id === aId);
  const b = mergedEntries.find((e) => e.id === bId);

  const handleImportFile = async (file: File) => {
    setImportError(null);
    setImportNotice(null);
    try {
      const text = await file.text();
      const isJson = /\.json$/i.test(file.name) || text.trim().startsWith("{");
      const payload = isJson ? parseImportJson(text) : parseImportCsv(text);
      const [entryA, entryB] = payloadToEntries(payload);
      setImportedEntries((prev) => {
        const filtered = prev.filter((e) => e.id !== entryA.id && e.id !== entryB.id);
        return [entryA, entryB, ...filtered].slice(0, 20);
      });
      setAId(entryA.id);
      setBId(entryB.id);
      setImportNotice(`Imported ${entryA.label} vs ${entryB.label}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import file");
    }
  };

  const clearImported = () => {
    setImportedEntries([]);
    setImportNotice(null);
    setImportError(null);
  };




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

  const builtA = useMemo(() => (a ? buildInp({ ...defaultOptions, ...a.opts } as InpOptions) : null), [a]);
  const builtB = useMemo(() => (b ? buildInp({ ...defaultOptions, ...b.opts } as InpOptions) : null), [b]);

  const [overlayMetric, setOverlayMetric] = useState<"flooded" | "surcharged">("flooded");
  const overlayDiff = overlayMetric === "flooded" ? nodeDiff.flooded : nodeDiff.surcharged;

  const exportComparison = (format: "csv" | "json") => {
    if (!a || !b) return;
    const payload = buildExportPayload(a, b, nodeDiff);
    const [content, mime, ext] =
      format === "json"
        ? [JSON.stringify(payload, null, 2), "application/json", "json"]
        : [buildCsv(payload), "text/csv", "csv"];
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `compare_${a.label}_vs_${b.label}_${Date.now()}.${ext}`.replace(/\s+/g, "");
    link.click();
    URL.revokeObjectURL(url);
  };


  if (mergedEntries.length < 2) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <p>
          Need at least two runs to compare. Run more simulations from the
          <span className="mx-1 font-mono text-primary">Engine</span> or
          <span className="mx-1 font-mono text-primary">Batch</span> tab, or import a previously
          exported comparison.
        </p>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            Import comparison…
          </Button>
        </div>
        {importError && <p className="text-xs text-destructive">{importError}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="rounded-md border border-border bg-card/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Compare two runs</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Highlights the delta in key metrics and the set difference of flooded /
              surcharged nodes between two runs. Selection is remembered across reloads;
              imported runs are tagged and stored locally.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              title="Load a previously exported comparison (JSON or CSV)"
            >
              Import…
            </Button>
            {importedEntries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearImported}
                title="Remove imported runs from the picker"
              >
                Clear imports
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!a || !b}
              onClick={() => exportComparison("csv")}
              title="Download the current comparison as CSV"
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!a || !b}
              onClick={() => exportComparison("json")}
              title="Download the current comparison as JSON"
            >
              Export JSON
            </Button>
          </div>
        </div>
        {(importError || importNotice) && (
          <p
            className={`mt-2 text-xs ${
              importError ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {importError ?? importNotice}
          </p>
        )}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <RunPicker label="Run A" value={aId} onChange={setAId} entries={mergedEntries} exclude={bId} />
          <RunPicker label="Run B" value={bId} onChange={setBId} entries={mergedEntries} exclude={aId} />
        </div>
      </div>


      {a && b ? (
        <>
          <DiffOverlay
            metric={overlayMetric}
            onMetricChange={setOverlayMetric}
            builtA={builtA}
            builtB={builtB}
            a={a}
            b={b}
            diff={overlayDiff}
          />

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

// Classification colors for the overlay + legend.
// only-A = destructive red, only-B = accent/blue, both = primary purple, else muted.
const CLS_COLORS = {
  onlyA: { fill: "hsl(var(--destructive))", stroke: "hsl(var(--destructive))" },
  onlyB: { fill: "hsl(var(--accent))", stroke: "hsl(var(--accent))" },
  both: { fill: "hsl(var(--primary))", stroke: "hsl(var(--primary))" },
  none: { fill: "hsl(var(--muted-foreground) / 0.35)", stroke: "hsl(var(--border))" },
} as const;

type Cls = keyof typeof CLS_COLORS;

function DiffOverlay({
  metric,
  onMetricChange,
  builtA,
  builtB,
  a,
  b,
  diff,
}: {
  metric: "flooded" | "surcharged";
  onMetricChange: (m: "flooded" | "surcharged") => void;
  builtA: BuildResult | null;
  builtB: BuildResult | null;
  a: RunHistoryEntry;
  b: RunHistoryEntry;
  diff: { onlyA: string[]; onlyB: string[]; both: string[] };
}) {
  const onlyA = useMemo(() => new Set(diff.onlyA), [diff]);
  const onlyB = useMemo(() => new Set(diff.onlyB), [diff]);
  const both = useMemo(() => new Set(diff.both), [diff]);

  const classify = (nodeId: number): Cls => {
    const s = String(nodeId);
    if (both.has(s)) return "both";
    if (onlyA.has(s)) return "onlyA";
    if (onlyB.has(s)) return "onlyB";
    return "none";
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Node overlay</h4>
          <p className="text-[11px] text-muted-foreground">
            Each run rendered on its own topology; nodes are colored by set membership so
            only-A, only-B, and both are visible in a single view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            metric:
          </span>
          {(["flooded", "surcharged"] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={metric === m ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => onMetricChange(m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
        <LegendSwatch cls="onlyA" label={`only in A · ${diff.onlyA.length}`} />
        <LegendSwatch cls="onlyB" label={`only in B · ${diff.onlyB.length}`} />
        <LegendSwatch cls="both" label={`in both · ${diff.both.length}`} />
        <LegendSwatch cls="none" label="unaffected" />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <OverlayCanvas title={`Run A · ${a.label}`} built={builtA} classify={classify} />
        <OverlayCanvas title={`Run B · ${b.label}`} built={builtB} classify={classify} />
      </div>
    </div>
  );
}

function LegendSwatch({ cls, label }: { cls: Cls; label: string }) {
  const c = CLS_COLORS[cls];
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full border"
        style={{ background: c.fill, borderColor: c.stroke }}
      />
      <span className="font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function OverlayCanvas({
  title,
  built,
  classify,
}: {
  title: string;
  built: BuildResult | null;
  classify: (n: number) => Cls;
}) {
  if (!built) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
        {title} — no geometry
      </div>
    );
  }
  const coords = built.coords;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [, [x, y]] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = 1; maxY = 1;
  }
  const pad = Math.max((maxX - minX) * 0.05, (maxY - minY) * 0.05, 1);
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX;
  const h = maxY - minY;
  // Flip Y so SVG matches HolyTreeCanvas orientation (y-up in data, y-down in svg).
  const project = (x: number, y: number): [number, number] => [x - minX, maxY - y];

  const nodeCount = built.tree.nodes.size;
  const r = nodeCount > 2000 ? 0.6 : nodeCount > 500 ? 1.0 : 1.6;

  // Draw affected nodes last so they sit on top.
  const nodes: Array<{ id: number; cls: Cls; x: number; y: number }> = [];
  for (const n of built.tree.nodes) {
    const c = coords.get(n);
    if (!c) continue;
    const [px, py] = project(c[0], c[1]);
    nodes.push({ id: n, cls: classify(n), x: px, y: py });
  }
  nodes.sort((a, b) => order(a.cls) - order(b.cls));

  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title} · {nodeCount} nodes
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-64 w-full rounded border border-border bg-background"
      >
        <g stroke="hsl(var(--border))" strokeWidth={Math.max(w, h) * 0.0008} opacity={0.6}>
          {Array.from(built.tree.edges).map(([from, to], i) => {
            const c1 = coords.get(from);
            const c2 = coords.get(to);
            if (!c1 || !c2) return null;
            const [x1, y1] = project(c1[0], c1[1]);
            const [x2, y2] = project(c2[0], c2[1]);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const c = CLS_COLORS[n.cls];
            const rr = n.cls === "none" ? r : r * 1.9;
            return (
              <circle
                key={n.id}
                cx={n.x}
                cy={n.y}
                r={rr}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={n.cls === "none" ? 0 : rr * 0.35}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function order(cls: Cls): number {
  return cls === "none" ? 0 : cls === "both" ? 1 : 2;
}

// ---------- Export helpers ----------

interface ExportPayload {
  generatedAt: string;
  runA: RunSummary;
  runB: RunSummary;
  metrics: Array<{
    metric: string;
    runA: number | null | undefined;
    runB: number | null | undefined;
    delta: number | null;
  }>;
  nodeDiff: {
    flooded: { onlyA: string[]; onlyB: string[]; both: string[] };
    surcharged: { onlyA: string[]; onlyB: string[]; both: string[] };
  };
}

interface RunSummary {
  id: string;
  label: string;
  timestamp: string;
  inputVersion: string;
  engine: string;
  nodeCount: number;
  conduitCount: number;
  durationSec: number;
  steps: number;
  optsJson: string;
}

function summarizeRun(e: RunHistoryEntry): RunSummary {
  return {
    id: e.id,
    label: e.label,
    timestamp: new Date(e.timestamp).toISOString(),
    inputVersion: e.inputVersion,
    engine: e.meta.engine,
    nodeCount: e.meta.nodeCount,
    conduitCount: e.meta.conduitCount,
    durationSec: e.meta.durationMs / 1000,
    steps: e.meta.steps,
    optsJson: JSON.stringify(e.opts ?? {}),
  };
}


function buildExportPayload(
  a: RunHistoryEntry,
  b: RunHistoryEntry,
  nodeDiff: ExportPayload["nodeDiff"],
): ExportPayload {
  const delta = (av: number | null | undefined, bv: number | null | undefined) =>
    av == null || bv == null ? null : bv - av;
  return {
    generatedAt: new Date().toISOString(),
    runA: summarizeRun(a),
    runB: summarizeRun(b),
    metrics: [
      { metric: "flow_continuity_pct", runA: a.metrics.flowContinuityPct, runB: b.metrics.flowContinuityPct, delta: delta(a.metrics.flowContinuityPct, b.metrics.flowContinuityPct) },
      { metric: "runoff_continuity_pct", runA: a.metrics.runoffContinuityPct, runB: b.metrics.runoffContinuityPct, delta: delta(a.metrics.runoffContinuityPct, b.metrics.runoffContinuityPct) },
      { metric: "flooded_nodes", runA: a.metrics.floodedNodes, runB: b.metrics.floodedNodes, delta: delta(a.metrics.floodedNodes, b.metrics.floodedNodes) },
      { metric: "surcharged_nodes", runA: a.metrics.surchargedNodes, runB: b.metrics.surchargedNodes, delta: delta(a.metrics.surchargedNodes, b.metrics.surchargedNodes) },
      { metric: "max_surcharge_hours", runA: a.metrics.maxSurchargeHours, runB: b.metrics.maxSurchargeHours, delta: delta(a.metrics.maxSurchargeHours, b.metrics.maxSurchargeHours) },
      { metric: "analysis_errors", runA: a.metrics.analysisErrors, runB: b.metrics.analysisErrors, delta: delta(a.metrics.analysisErrors, b.metrics.analysisErrors) },
      { metric: "node_count", runA: a.meta.nodeCount, runB: b.meta.nodeCount, delta: delta(a.meta.nodeCount, b.meta.nodeCount) },
      { metric: "conduit_count", runA: a.meta.conduitCount, runB: b.meta.conduitCount, delta: delta(a.meta.conduitCount, b.meta.conduitCount) },
      { metric: "runtime_sec", runA: a.meta.durationMs / 1000, runB: b.meta.durationMs / 1000, delta: delta(a.meta.durationMs / 1000, b.meta.durationMs / 1000) },
    ],
    nodeDiff,
  };
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(p: ExportPayload): string {
  const lines: string[] = [];
  lines.push("# Collatz SWMM5 comparison export");
  lines.push(`# generated_at,${csvEscape(p.generatedAt)}`);
  lines.push("");
  lines.push("section,field,run_a,run_b");
  const runFields: Array<keyof RunSummary> = [
    "id", "label", "timestamp", "inputVersion", "engine", "nodeCount", "conduitCount", "durationSec", "steps", "optsJson",
  ];
  for (const f of runFields) {
    lines.push(`run_meta,${f},${csvEscape(p.runA[f])},${csvEscape(p.runB[f])}`);
  }
  lines.push("");
  lines.push("metric,run_a,run_b,delta_b_minus_a");
  for (const m of p.metrics) {
    lines.push(`${csvEscape(m.metric)},${csvEscape(m.runA)},${csvEscape(m.runB)},${csvEscape(m.delta)}`);
  }
  lines.push("");
  lines.push("node_diff_group,node_id");
  const groups: Array<[string, string[]]> = [
    ["flooded_only_a", p.nodeDiff.flooded.onlyA],
    ["flooded_only_b", p.nodeDiff.flooded.onlyB],
    ["flooded_both", p.nodeDiff.flooded.both],
    ["surcharged_only_a", p.nodeDiff.surcharged.onlyA],
    ["surcharged_only_b", p.nodeDiff.surcharged.onlyB],
    ["surcharged_both", p.nodeDiff.surcharged.both],
  ];
  for (const [name, ids] of groups) {
    for (const id of ids) lines.push(`${csvEscape(name)},${csvEscape(id)}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- Import helpers ----------

function parseImportJson(text: string): ExportPayload {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || !raw.runA || !raw.runB || !raw.metrics || !raw.nodeDiff) {
    throw new Error("JSON is missing required fields (runA/runB/metrics/nodeDiff).");
  }
  return raw as ExportPayload;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ""; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function coerceNumber(v: string): number | null {
  if (v === "" || v === "null" || v === "undefined") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseImportCsv(text: string): ExportPayload {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const metaMap: Record<string, [string, string]> = {};
  const metricsArr: ExportPayload["metrics"] = [];
  const nodeGroups: Record<string, string[]> = {
    flooded_only_a: [], flooded_only_b: [], flooded_both: [],
    surcharged_only_a: [], surcharged_only_b: [], surcharged_both: [],
  };
  let generatedAt = new Date().toISOString();
  let section: "none" | "meta" | "metric" | "node" = "none";

  for (const raw of lines) {
    if (raw.startsWith("# generated_at")) {
      const parts = parseCsvLine(raw.replace(/^#\s*/, ""));
      if (parts[1]) generatedAt = parts[1];
      continue;
    }
    if (raw.startsWith("#")) continue;
    const cols = parseCsvLine(raw);
    if (cols[0] === "section" && cols[1] === "field") { section = "meta"; continue; }
    if (cols[0] === "metric" && cols[1] === "run_a") { section = "metric"; continue; }
    if (cols[0] === "node_diff_group") { section = "node"; continue; }
    if (section === "meta" && cols[0] === "run_meta") {
      metaMap[cols[1]] = [cols[2] ?? "", cols[3] ?? ""];
    } else if (section === "metric" && cols[0]) {
      metricsArr.push({
        metric: cols[0],
        runA: coerceNumber(cols[1] ?? ""),
        runB: coerceNumber(cols[2] ?? ""),
        delta: coerceNumber(cols[3] ?? ""),
      });
    } else if (section === "node" && cols[0] && cols[1]) {
      const g = nodeGroups[cols[0]];
      if (g) g.push(cols[1]);
    }
  }

  const makeSummary = (idx: 0 | 1): RunSummary => ({
    id: metaMap.id?.[idx] || `imported_${idx}`,
    label: metaMap.label?.[idx] || `Run ${idx === 0 ? "A" : "B"}`,
    timestamp: metaMap.timestamp?.[idx] || new Date().toISOString(),
    inputVersion: metaMap.inputVersion?.[idx] || "imported",
    engine: metaMap.engine?.[idx] || "wasm",
    nodeCount: Number(metaMap.nodeCount?.[idx] || 0),
    conduitCount: Number(metaMap.conduitCount?.[idx] || 0),
    durationSec: Number(metaMap.durationSec?.[idx] || 0),
    steps: Number(metaMap.steps?.[idx] || 0),
    optsJson: metaMap.optsJson?.[idx] || "{}",
  });

  return {
    generatedAt,
    runA: makeSummary(0),
    runB: makeSummary(1),
    metrics: metricsArr,
    nodeDiff: {
      flooded: {
        onlyA: nodeGroups.flooded_only_a,
        onlyB: nodeGroups.flooded_only_b,
        both: nodeGroups.flooded_both,
      },
      surcharged: {
        onlyA: nodeGroups.surcharged_only_a,
        onlyB: nodeGroups.surcharged_only_b,
        both: nodeGroups.surcharged_both,
      },
    },
  };
}

function payloadToEntries(p: ExportPayload): [RunHistoryEntry, RunHistoryEntry] {
  const metricByName = new Map(p.metrics.map((m) => [m.metric, m]));
  const num = (name: string, side: "runA" | "runB"): number | null => {
    const m = metricByName.get(name);
    if (!m) return null;
    const v = m[side];
    return v == null ? null : Number(v);
  };

  const toEntry = (side: "runA" | "runB", summary: RunSummary): RunHistoryEntry => {
    const isA = side === "runA";
    const floodedIds = isA
      ? [...p.nodeDiff.flooded.onlyA, ...p.nodeDiff.flooded.both]
      : [...p.nodeDiff.flooded.onlyB, ...p.nodeDiff.flooded.both];
    const surchargedIds = isA
      ? [...p.nodeDiff.surcharged.onlyA, ...p.nodeDiff.surcharged.both]
      : [...p.nodeDiff.surcharged.onlyB, ...p.nodeDiff.surcharged.both];
    let opts: Partial<InpOptions> = {};
    try { opts = JSON.parse(summary.optsJson || "{}"); } catch { /* ignore */ }
    const stamp = Date.parse(summary.timestamp);
    const engine: "wasm" = "wasm";
    return {
      id: `imported_${summary.id}`,
      timestamp: Number.isFinite(stamp) ? stamp : Date.now(),
      label: `${summary.label} · imported`,
      inputVersion: summary.inputVersion,
      opts,
      meta: {
        engine,
        durationMs: (summary.durationSec || 0) * 1000,
        nodeCount: summary.nodeCount || 0,
        conduitCount: summary.conduitCount || 0,
        steps: summary.steps || 0,
      },
      metrics: {
        flowContinuityPct: num("flow_continuity_pct", side),
        runoffContinuityPct: num("runoff_continuity_pct", side),
        floodedNodes: num("flooded_nodes", side) ?? floodedIds.length,
        surchargedNodes: num("surcharged_nodes", side) ?? surchargedIds.length,
        maxSurchargeHours: num("max_surcharge_hours", side),
        analysisErrors: num("analysis_errors", side) ?? 0,
        floodedNodeIds: floodedIds,
        surchargedNodeIds: surchargedIds,
      },
    };
  };

  return [toEntry("runA", p.runA), toEntry("runB", p.runB)];
}


