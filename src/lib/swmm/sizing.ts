// Hydraulic auto-sizing and diameter-mode comparison.
// Iteratively runs the SWMM5 WASM engine to find the smallest standard
// diameter that satisfies user constraints (max d/D, velocity, allowed
// flooded nodes), and compares uniform vs √upstream progressive sizing.

import { buildInp, type InpOptions, type BuildResult } from "./inp";
import { startEngine, type EngineResult } from "./engine";
import { parseRptSummary, type RptSummary } from "./rpt";

/** Common US standard PVC/RCP diameters (ft). */
export const STANDARD_DIAMETERS_FT = [
  0.5, 0.667, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0,
];
/** SI standard pipe diameters (m). */
export const STANDARD_DIAMETERS_M = [
  0.15, 0.2, 0.25, 0.3, 0.375, 0.45, 0.525, 0.6, 0.75, 0.9, 1.05, 1.2, 1.5, 1.8, 2.4,
];

export function standardDiametersFor(units: InpOptions["flowUnits"]): number[] {
  return units === "CFS" ? STANDARD_DIAMETERS_FT : STANDARD_DIAMETERS_M;
}

export interface SizingConstraints {
  maxDepthRatio: number;
  maxVelocity: number;
  maxFloodedNodes: number;
}

export const defaultSizingConstraints: SizingConstraints = {
  maxDepthRatio: 0.85,
  maxVelocity: 15,
  maxFloodedNodes: 0,
};

export interface SizingAttempt {
  diameter: number;
  flooded: number;
  maxDepthRatio: number;
  maxVelocity: number;
  continuityPct: number | null;
  runtimeMs: number;
  passed: boolean;
  reason: string;
}

export interface AutoSizeOutcome {
  chosen: SizingAttempt | null;
  attempts: SizingAttempt[];
  finalBuilt: BuildResult;
  finalResult: EngineResult;
  finalMetrics: RptSummary;
}

function computeMaxDepthRatio(result: EngineResult, diameterFor: (linkId: string) => number): number {
  let mx = 0;
  for (const l of result.links) {
    const D = diameterFor(l.id);
    if (!isFinite(D) || D <= 0) continue;
    for (const d of l.depth) {
      const r = d / D;
      if (r > mx) mx = r;
    }
  }
  return mx;
}

function computeMaxVelocity(result: EngineResult): number {
  let mx = 0;
  for (const l of result.links) {
    for (const v of l.velocity) {
      const a = Math.abs(v);
      if (a > mx) mx = a;
    }
  }
  return mx;
}

export class CancelledError extends Error {
  constructor() { super("cancelled"); this.name = "CancelledError"; }
}

function runWithSignal(
  built: BuildResult,
  signal?: AbortSignal,
  onEnginePct?: (pct: number) => void,
): Promise<EngineResult> {
  const handle = startEngine(built, { onProgress: onEnginePct });
  if (signal) {
    if (signal.aborted) { handle.cancel(); return Promise.reject(new CancelledError()); }
    signal.addEventListener("abort", () => handle.cancel(), { once: true });
  }
  return handle.promise.catch((e) => {
    if (signal?.aborted) throw new CancelledError();
    throw e;
  });
}

export async function autoSizeUniform(
  baseOpts: InpOptions,
  constraints: SizingConstraints,
  diameters: number[] = standardDiametersFor(baseOpts.flowUnits),
  onProgress?: (idx: number, total: number, attempt: SizingAttempt, enginePct?: number) => void,
  signal?: AbortSignal,
): Promise<AutoSizeOutcome> {
  const sorted = [...diameters].sort((a, b) => a - b);
  const attempts: SizingAttempt[] = [];
  let chosen: SizingAttempt | null = null;
  let finalBuilt: BuildResult | null = null;
  let finalResult: EngineResult | null = null;
  let finalMetrics: RptSummary | null = null;

  for (let i = 0; i < sorted.length; i++) {
    if (signal?.aborted) throw new CancelledError();
    const d = sorted[i];
    const opts: InpOptions = { ...baseOpts, diameter: d, progressiveSizing: false };
    const built = buildInp(opts);
    const t0 = performance.now();
    const result = await runWithSignal(built, signal, (pct) => {
      onProgress?.(i + 1, sorted.length, {
        diameter: d, flooded: 0, maxDepthRatio: 0, maxVelocity: 0,
        continuityPct: null, runtimeMs: 0, passed: false, reason: "running",
      }, pct);
    });
    const runtimeMs = performance.now() - t0;
    const metrics = parseRptSummary(result.rpt);
    const maxDR = computeMaxDepthRatio(result, () => d);
    const maxV = computeMaxVelocity(result);
    const flooded = metrics.floodedNodes.length;
    const reasons: string[] = [];
    if (flooded > constraints.maxFloodedNodes)
      reasons.push(`flooded ${flooded} > ${constraints.maxFloodedNodes}`);
    if (maxDR > constraints.maxDepthRatio)
      reasons.push(`d/D ${maxDR.toFixed(2)} > ${constraints.maxDepthRatio}`);
    if (maxV > constraints.maxVelocity)
      reasons.push(`v ${maxV.toFixed(2)} > ${constraints.maxVelocity}`);
    const passed = reasons.length === 0;
    const attempt: SizingAttempt = {
      diameter: d,
      flooded,
      maxDepthRatio: maxDR,
      maxVelocity: maxV,
      continuityPct: metrics.flowContinuityPct,
      runtimeMs,
      passed,
      reason: reasons.join("; "),
    };
    attempts.push(attempt);
    finalBuilt = built;
    finalResult = result;
    finalMetrics = metrics;
    onProgress?.(i + 1, sorted.length, attempt, 100);
    if (passed) {
      chosen = attempt;
      break;
    }
  }

  return {
    chosen,
    attempts,
    finalBuilt: finalBuilt!,
    finalResult: finalResult!,
    finalMetrics: finalMetrics!,
  };
}

export interface ModeRunSummary {
  mode: "uniform" | "progressive";
  diameter: number;
  maxDepthRatio: number;
  maxVelocity: number;
  flooded: number;
  maxSurchargeHours: number | null;
  continuityPct: number | null;
  runtimeMs: number;
  built: BuildResult;
  result: EngineResult;
  metrics: RptSummary;
}

async function runOne(
  opts: InpOptions,
  mode: "uniform" | "progressive",
  signal?: AbortSignal,
  onPct?: (pct: number) => void,
): Promise<ModeRunSummary> {
  const built = buildInp(opts);
  const t0 = performance.now();
  const result = await runWithSignal(built, signal, onPct);
  const runtimeMs = performance.now() - t0;
  const metrics = parseRptSummary(result.rpt);
  const maxDR = computeMaxDepthRatio(result, (id) => built.conduitDiameter.get(id) ?? opts.diameter);
  const maxV = computeMaxVelocity(result);
  return {
    mode,
    diameter: opts.diameter,
    maxDepthRatio: maxDR,
    maxVelocity: maxV,
    flooded: metrics.floodedNodes.length,
    maxSurchargeHours: metrics.maxSurchargeHours,
    continuityPct: metrics.flowContinuityPct,
    runtimeMs,
    built,
    result,
    metrics,
  };
}

export async function compareDiameterModes(
  baseOpts: InpOptions,
  onProgress?: (label: string, enginePct?: number) => void,
  signal?: AbortSignal,
): Promise<{ uniform: ModeRunSummary; progressive: ModeRunSummary }> {
  onProgress?.("uniform", 0);
  const uniform = await runOne({ ...baseOpts, progressiveSizing: false }, "uniform", signal, (p) => onProgress?.("uniform", p));
  onProgress?.("progressive", 0);
  const progressive = await runOne({ ...baseOpts, progressiveSizing: true }, "progressive", signal, (p) => onProgress?.("progressive", p));
  return { uniform, progressive };
}
