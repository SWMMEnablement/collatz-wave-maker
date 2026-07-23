import type { InpOptions } from "./inp";
import type { BuildResult } from "./inp";

export interface ValidationIssue {
  level: "error" | "warning";
  section: "INFLOWS" | "TIMESERIES" | "COORDINATES" | "OPTIONS" | "DWF" | "RAINGAGES" | "SUBCATCHMENTS";
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  ok: boolean;
}

export function validateInp(opts: InpOptions, built: BuildResult): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (section: ValidationIssue["section"], message: string) =>
    issues.push({ level: "error", section, message });
  const warn = (section: ValidationIssue["section"], message: string) =>
    issues.push({ level: "warning", section, message });

  // TIMESERIES / trapezoid shape
  const sum = opts.trapRiseFrac + opts.trapPlateauFrac + opts.trapFallFrac;
  if (opts.trapRiseFrac < 0 || opts.trapPlateauFrac < 0 || opts.trapFallFrac < 0) {
    err("TIMESERIES", "Rise / plateau / fall fractions must be ≥ 0.");
  }
  if (sum <= 0) {
    err("TIMESERIES", "Trapezoid fractions sum to 0 — no inflow window defined.");
  } else if (sum > 1.001) {
    err("TIMESERIES", `Rise + plateau + fall = ${sum.toFixed(3)} exceeds 1.0 (simulation length).`);
  } else if (sum < 0.999) {
    warn("TIMESERIES", `Rise + plateau + fall = ${sum.toFixed(3)} < 1.0; inflow ends before sim finishes.`);
  }
  if (opts.peakInflow <= 0) {
    err("TIMESERIES", "Peak inflow must be > 0.");
  } else if (opts.peakInflow > 1000) {
    warn("TIMESERIES", `Peak inflow ${opts.peakInflow} is unusually large.`);
  }
  if (opts.endTimeSec < 43200) {
    err("OPTIONS", "End time must be ≥ 12 h (43200 s) for a full trapezoid.");
  }

  // INFLOWS
  const junctions = built.nodeCount - 1; // node 1 is the outfall
  if (junctions <= 0) {
    err("INFLOWS", "No junctions to apply inflows to (raise Max seed N).");
  }

  // COORDINATES / scale
  if (!Number.isFinite(opts.coordScale) || opts.coordScale <= 0) {
    err("COORDINATES", `Coordinate scale must be > 0 (got ${opts.coordScale}).`);
  } else if (opts.coordScale > 10) {
    warn("COORDINATES", `Coordinate scale ${opts.coordScale} is very large; SWMM viewer may zoom awkwardly.`);
  } else if (opts.coordScale < 0.001) {
    warn("COORDINATES", `Coordinate scale ${opts.coordScale} is very small; nodes may collapse to a point.`);
  }

  // DWF
  if (opts.dwfBaseflow < 0) {
    err("DWF", "DWF baseflow must be ≥ 0.");
  }

  // Storm / raingage
  if (opts.stormType !== "none") {
    if (opts.stormDepth <= 0) err("RAINGAGES", "Storm depth must be > 0.");
    if (opts.stormDurationHr <= 0) err("RAINGAGES", "Storm duration must be > 0 h.");
    if (opts.stormDurationHr * 60 > opts.endTimeSec / 60)
      warn("RAINGAGES", "Storm duration exceeds simulation end time — tail will be clipped.");
    if (opts.rainIntervalMin <= 0) err("RAINGAGES", "Rain interval must be > 0 min.");
    if (built.storm.length === 0)
      err("RAINGAGES", "Storm hyetograph is empty — check depth / duration / interval.");
    if (!opts.subcatchments)
      warn("RAINGAGES", "Storm is defined but no subcatchments — rainfall has nowhere to land.");
  }

  // Subcatchments
  if (opts.subcatchments) {
    if (opts.subcatchmentArea <= 0) err("SUBCATCHMENTS", "Subcatchment area must be > 0.");
    if (opts.imperviousPct < 0 || opts.imperviousPct > 100)
      err("SUBCATCHMENTS", "%Impervious must be between 0 and 100.");
    if (opts.subWidth <= 0) err("SUBCATCHMENTS", "Subcatchment width must be > 0.");
    if (opts.subSlope < 0) err("SUBCATCHMENTS", "Subcatchment slope must be ≥ 0.");
    if (opts.stormType === "none")
      warn("SUBCATCHMENTS", "Subcatchments enabled but stormType is 'none' — no runoff will be generated.");
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { issues, errors, warnings, ok: errors === 0 };
}
