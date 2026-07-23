// User-configurable thresholds for run metric coloring + stop-on-bad batch behavior.
// Persisted in localStorage.

import { useEffect, useState } from "react";
import type { RptSummary } from "./swmm/rpt";

export type Tone = "ok" | "warn" | "bad" | "muted";

export interface Thresholds {
  flowContinuityWarnPct: number; // e.g. 1
  flowContinuityBadPct: number; // e.g. 10
  runoffContinuityWarnPct: number;
  runoffContinuityBadPct: number;
  floodedNodesWarn: number; // > this => warn
  floodedNodesBad: number; // >= this => bad
  maxSurchargeWarnHrs: number; // > this => warn
  maxSurchargeBadHrs: number; // >= this => bad
  stopOnBad: boolean; // batch runner stops if any metric hits bad
}

export const defaultThresholds: Thresholds = {
  flowContinuityWarnPct: 1,
  flowContinuityBadPct: 10,
  runoffContinuityWarnPct: 1,
  runoffContinuityBadPct: 10,
  floodedNodesWarn: 0,
  floodedNodesBad: 10,
  maxSurchargeWarnHrs: 0,
  maxSurchargeBadHrs: 6,
  stopOnBad: true,
};

const KEY = "collatz-swmm.thresholds.v1";

export function useThresholds(): [Thresholds, (t: Thresholds) => void, () => void] {
  const [t, setT] = useState<Thresholds>(defaultThresholds);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setT({ ...defaultThresholds, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);
  const save = (next: Thresholds) => {
    setT(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const reset = () => save(defaultThresholds);
  return [t, save, reset];
}

export function toneForContinuity(
  pct: number | null | undefined,
  t: Thresholds,
  kind: "flow" | "runoff",
): Tone {
  if (pct == null) return "muted";
  const abs = Math.abs(pct);
  const warn = kind === "flow" ? t.flowContinuityWarnPct : t.runoffContinuityWarnPct;
  const bad = kind === "flow" ? t.flowContinuityBadPct : t.runoffContinuityBadPct;
  return abs >= bad ? "bad" : abs >= warn ? "warn" : "ok";
}

export function toneForFlooded(n: number, t: Thresholds): Tone {
  if (n >= t.floodedNodesBad) return "bad";
  if (n > t.floodedNodesWarn) return "warn";
  return "ok";
}

export function toneForSurcharge(h: number | null | undefined, t: Thresholds): Tone {
  const v = h ?? 0;
  if (v >= t.maxSurchargeBadHrs) return "bad";
  if (v > t.maxSurchargeWarnHrs) return "warn";
  return "ok";
}

export function exceedsBad(m: RptSummary, t: Thresholds): { bad: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const fc = Math.abs(m.flowContinuityPct ?? 0);
  const rc = Math.abs(m.runoffContinuityPct ?? 0);
  if (fc >= t.flowContinuityBadPct) reasons.push(`flow continuity ${fc.toFixed(2)}% ≥ ${t.flowContinuityBadPct}%`);
  if (rc >= t.runoffContinuityBadPct) reasons.push(`runoff continuity ${rc.toFixed(2)}% ≥ ${t.runoffContinuityBadPct}%`);
  if (m.floodedNodes.length >= t.floodedNodesBad)
    reasons.push(`${m.floodedNodes.length} flooded nodes ≥ ${t.floodedNodesBad}`);
  if ((m.maxSurchargeHours ?? 0) >= t.maxSurchargeBadHrs)
    reasons.push(`surcharge ${(m.maxSurchargeHours ?? 0).toFixed(2)}h ≥ ${t.maxSurchargeBadHrs}h`);
  if (m.analysisErrors.length > 0) reasons.push(`${m.analysisErrors.length} analysis error(s)`);
  return { bad: reasons.length > 0, reasons };
}
