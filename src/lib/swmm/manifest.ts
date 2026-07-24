// Deterministic run manifest. Captures generator inputs, model statistics,
// engine provenance, INP hash, and (optionally) run diagnostics.

import type { BuildResult, InpOptions } from "./inp";
import type { EngineResult } from "./engine";
import type { RptSummary } from "./rpt";
import type { EngineProvenance } from "./provenance";

export interface RunManifest {
  schema_version: "1.0";
  generator_version: string;
  generated_at: string;
  generator: {
    seed_min: number;
    seed_max: number;
    integer_mode: "Number (IEEE-754 float64)";
    iteration_cap: number;
    inflow_scope: InpOptions["inflowScope"];
    progressive_sizing: boolean;
    layout: InpOptions["layoutMode"];
    flow_units: InpOptions["flowUnits"];
    storm: InpOptions["stormType"];
    subcatchments: boolean;
    subcatchment_scope?: InpOptions["subcatchmentScope"];
    sub_area_mode?: InpOptions["subAreaMode"];
    end_time_sec: number;
    peak_inflow: number;
  };
  model: {
    total_nodes: number;
    generated_junctions: number;
    seed_count: number;
    leaf_count: number;
    conduit_count: number;
    subcatchment_count: number;
    inflow_nodes: number;
    max_depth: number;
    inp_sha256: string | null;
    inp_bytes: number;
  };
  engine: {
    name: string;
    version: string;
    package: string;
    package_version: string;
    wrapper_commit: string;
    wasm_sha256: string | null;
    wasm_bytes: number | null;
  };
  run?: {
    duration_ms: number;
    steps: number;
    flow_continuity_pct: number | null;
    runoff_continuity_pct: number | null;
    flooded_nodes: number;
    flooded_node_ids: string[];
    surcharged_nodes: number;
    surcharged_node_ids: string[];
    max_surcharge_hours: number | null;
    analysis_errors: string[];
  };
}

export const GENERATOR_VERSION = "2.1.0";
export const ITERATION_CAP = 100_000;

async function sha256Hex(text: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildManifest(
  opts: InpOptions,
  built: BuildResult,
  prov: EngineProvenance,
  run?: { result: EngineResult; metrics: RptSummary },
): Promise<RunManifest> {
  const inpSha = await sha256Hex(built.inp);
  const manifest: RunManifest = {
    schema_version: "1.0",
    generator_version: GENERATOR_VERSION,
    generated_at: new Date().toISOString(),
    generator: {
      seed_min: 2,
      seed_max: opts.maxSeed,
      integer_mode: "Number (IEEE-754 float64)",
      iteration_cap: ITERATION_CAP,
      inflow_scope: opts.inflowScope,
      progressive_sizing: opts.progressiveSizing,
      layout: opts.layoutMode,
      flow_units: opts.flowUnits,
      storm: opts.stormType,
      subcatchments: opts.subcatchments,
      subcatchment_scope: opts.subcatchments ? opts.subcatchmentScope : undefined,
      sub_area_mode: opts.subcatchments ? opts.subAreaMode : undefined,
      end_time_sec: opts.endTimeSec,
      peak_inflow: opts.peakInflow,
    },
    model: {
      total_nodes: built.nodeCount,
      generated_junctions: built.generatedCount,
      seed_count: built.seedCount,
      leaf_count: built.leafCount,
      conduit_count: built.conduitCount,
      subcatchment_count: built.subcatchmentCount,
      inflow_nodes: built.inflowNodes.length,
      max_depth: built.tree.depth.size ? Math.max(...built.tree.depth.values()) : 0,
      inp_sha256: inpSha,
      inp_bytes: new TextEncoder().encode(built.inp).byteLength,
    },
    engine: {
      name: prov.engineName,
      version: prov.engineVersion,
      package: prov.packageName,
      package_version: prov.packageVersion,
      wrapper_commit: prov.wrapperCommit,
      wasm_sha256: prov.assetSha256,
      wasm_bytes: prov.assetBytes,
    },
  };
  if (run) {
    manifest.run = {
      duration_ms: Math.round(run.result.durationMs),
      steps: run.result.times.length,
      flow_continuity_pct: run.metrics.flowContinuityPct,
      runoff_continuity_pct: run.metrics.runoffContinuityPct,
      flooded_nodes: run.metrics.floodedNodes.length,
      flooded_node_ids: run.metrics.floodedNodes.map((n) => n.id),
      surcharged_nodes: run.metrics.surchargedNodes.length,
      surcharged_node_ids: run.metrics.surchargedNodes.map((n) => n.id),
      max_surcharge_hours: run.metrics.maxSurchargeHours,
      analysis_errors: run.metrics.analysisErrors,
    };
  }
  return manifest;
}
