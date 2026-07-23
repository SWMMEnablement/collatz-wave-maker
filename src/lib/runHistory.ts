// Run history — persists a lightweight summary of every SWMM run in
// localStorage. The full EngineResult (with Uint8Array .out and time series)
// stays in an in-memory Map keyed by entry id, so clicking a history row can
// re-open the results without a re-run within the same session.

import { useCallback, useEffect, useState } from "react";
import type { InpOptions } from "./swmm/inp";
import type { EngineResult } from "./swmm/engine";
import type { RptSummary } from "./swmm/rpt";

export interface RunHistoryEntry {
  id: string;
  timestamp: number;
  label: string;
  inputVersion: string; // short signature of the inputs that produced this run
  opts: Partial<InpOptions>;
  meta: {
    engine: "wasm" | "stub";
    durationMs: number;
    nodeCount: number;
    conduitCount: number;
    steps: number;
  };
  metrics: {
    flowContinuityPct: number | null;
    runoffContinuityPct: number | null;
    floodedNodes: number;
    surchargedNodes: number;
    maxSurchargeHours: number | null;
    analysisErrors: number;
  };
}

const KEY = "collatz-swmm.history.v1";
const MAX_ENTRIES = 30;

// Full results live in memory only.
const resultStore = new Map<string, EngineResult>();

export function getStoredResult(id: string): EngineResult | undefined {
  return resultStore.get(id);
}

export function summarizeInputs(opts: InpOptions): string {
  return [
    `N=${opts.maxSeed}`,
    `${opts.flowUnits}`,
    opts.subcatchments ? `sub=${opts.subcatchmentScope}` : "no-sub",
    opts.stormType && opts.stormType !== "none" ? `storm=${opts.stormType}` : "no-storm",
    `dur=${Math.round((opts.endTimeSec ?? 0) / 3600)}h`,
  ].join(" · ");
}

export function makeHistoryEntry(
  opts: InpOptions,
  built: { nodeCount: number; conduitCount: number },
  result: EngineResult,
  metrics: RptSummary,
): RunHistoryEntry {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const inputVersion = summarizeInputs(opts);
  const entry: RunHistoryEntry = {
    id,
    timestamp: Date.now(),
    label: `N=${opts.maxSeed}`,
    inputVersion,
    // store only the fields we care to re-display
    opts: {
      maxSeed: opts.maxSeed,
      flowUnits: opts.flowUnits,
      inflowScope: opts.inflowScope,
      peakInflow: opts.peakInflow,
      subcatchments: opts.subcatchments,
      subcatchmentScope: opts.subcatchmentScope,
      stormType: opts.stormType,
      endTimeSec: opts.endTimeSec,
      maxDepth: opts.maxDepth,
    },
    meta: {
      engine: result.engine,
      durationMs: result.durationMs,
      nodeCount: built.nodeCount,
      conduitCount: built.conduitCount,
      steps: result.times.length,
    },
    metrics: {
      flowContinuityPct: metrics.flowContinuityPct,
      runoffContinuityPct: metrics.runoffContinuityPct,
      floodedNodes: metrics.floodedNodes.length,
      surchargedNodes: metrics.surchargedNodes.length,
      maxSurchargeHours: metrics.maxSurchargeHours,
      analysisErrors: metrics.analysisErrors.length,
    },
  };
  return entry;
}

export function useRunHistory() {
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: RunHistoryEntry[]) => {
    setEntries(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  const add = useCallback((entry: RunHistoryEntry, result?: EngineResult) => {
    if (result) resultStore.set(entry.id, result);
    setEntries((prev) => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    resultStore.delete(id);
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    resultStore.clear();
    persist([]);
  }, []);

  return { entries, add, remove, clear, getResult: getStoredResult };
}
