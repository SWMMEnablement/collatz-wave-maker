// SWMM5 engine runner.
// Loads the real Emscripten-compiled swmm5 from /wasm/swmm5.js + /wasm/swmm5.wasm.
// Falls back to a synthetic stub only if the wasm fails to load.

import type { BuildResult } from "./inp";
import { parseSwmmOut } from "./outfile";

export interface NodeSeries {
  node: number;
  depth: number[]; // depth at each timestep
  inflow: number[];
}

export interface EngineResult {
  rpt: string;
  out: Uint8Array | null;
  times: number[]; // minutes
  series: NodeSeries[];
  engine: "wasm" | "stub";
  log: string;
  durationMs: number;
}

declare global {
  interface Window {
    // Emscripten factory exported by swmm5.js (MODULARIZE=1 EXPORT_NAME=createSwmmModule)
    createSwmmModule?: (opts?: Record<string, unknown>) => Promise<EmscriptenModule>;
  }
}

interface EmscriptenFS {
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string, opts?: { encoding?: "utf8" | "binary" }): string | Uint8Array;
  unlink?(path: string): void;
}
interface EmscriptenModule {
  FS: EmscriptenFS;
  ccall?: (name: string, ret: string, args: string[], values: unknown[]) => unknown;
  cwrap?: (name: string, ret: string, args: string[]) => (...a: unknown[]) => unknown;
  callMain?: (args: string[]) => number;
}

let modulePromise: Promise<EmscriptenModule | null> | null = null;

async function loadWasmModule(): Promise<EmscriptenModule | null> {
  if (typeof window === "undefined") return null;
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    try {
      // Probe for the glue file first to avoid noisy script errors.
      const probe = await fetch("/wasm/swmm5.js", { method: "HEAD" });
      if (!probe.ok) return null;
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/wasm/swmm5.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("failed to load /wasm/swmm5.js"));
        document.head.appendChild(s);
      });
      if (!window.createSwmmModule) return null;
      const mod = await window.createSwmmModule({
        locateFile: (p: string) => "/wasm/" + p,
        print: () => {},
        printErr: () => {},
      });
      return mod;
    } catch {
      return null;
    }
  })();
  return modulePromise;
}

async function runWasm(inp: string): Promise<EngineResult | null> {
  const mod = await loadWasmModule();
  if (!mod) return null;
  const t0 = performance.now();
  const log: string[] = [];
  try {
    mod.FS.writeFile("/input.inp", inp);
    mod.FS.writeFile("/report.rpt", "");
    mod.FS.writeFile("/output.out", new Uint8Array());

    const runner =
      mod.cwrap?.("swmm_run", "number", ["string", "string", "string"]) ??
      null;
    let rc = -1;
    if (runner) {
      rc = Number(runner("/input.inp", "/report.rpt", "/output.out"));
    } else if (mod.callMain) {
      rc = mod.callMain(["/input.inp", "/report.rpt", "/output.out"]);
    }
    log.push(`swmm_run returned ${rc}`);
    const rpt = mod.FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
    let out: Uint8Array | null = null;
    try {
      out = mod.FS.readFile("/output.out") as Uint8Array;
    } catch {
      out = null;
    }
    return {
      rpt,
      out,
      times: [],
      series: [],
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
    };
  } catch (e) {
    log.push("wasm error: " + (e as Error).message);
    return {
      rpt: log.join("\n"),
      out: null,
      times: [],
      series: [],
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
    };
  }
}

function runStub(built: BuildResult, inp: string): EngineResult {
  const t0 = performance.now();
  const tree = built.tree;

  // upstream node count per node (for cumulative DWF)
  const upstream = new Map<number, number>();
  const children = new Map<number, number[]>();
  for (const [from, to] of tree.edges) {
    if (!children.has(to)) children.set(to, []);
    children.get(to)!.push(from);
  }
  const countUp = (n: number): number => {
    if (upstream.has(n)) return upstream.get(n)!;
    let c = 1;
    for (const ch of children.get(n) ?? []) c += countUp(ch);
    upstream.set(n, c);
    return c;
  };
  for (const n of tree.nodes) countUp(n);

  // 6 hours, 5-minute steps = 73 points; ramp + peak + recede
  const N = 73;
  const times: number[] = [];
  const wave: number[] = [];
  for (let i = 0; i < N; i++) {
    const m = i * 5;
    times.push(m);
    const x = (m - 120) / 60; // peak ~2h
    wave.push(Math.exp(-x * x * 0.6));
  }

  const baseflow = Math.max(0, Number(built.inp ? 0.1 : 0.1)); // use opts default-ish
  const series: NodeSeries[] = [];
  const totalUp = upstream.get(1) ?? 1;
  for (const n of tree.nodes) {
    const up = upstream.get(n) ?? 1;
    const peakQ = baseflow * up;
    const inflow = wave.map((w) => +(peakQ * (0.3 + 0.7 * w)).toFixed(4));
    const cap = built.inverts.get(n) !== undefined ? 10 : 10;
    const depth = inflow.map((q) =>
      +Math.min(cap, Math.log10(1 + q) * 1.5).toFixed(4),
    );
    series.push({ node: n, depth, inflow });
  }

  const peakDepthByNode = series
    .map((s) => ({ n: s.node, d: Math.max(...s.depth), q: Math.max(...s.inflow) }))
    .sort((a, b) => b.d - a.d);

  const lines: string[] = [];
  lines.push("  EPA STORM WATER MANAGEMENT MODEL - VERSION 5 (stub engine)");
  lines.push("  ----------------------------------------------------------");
  lines.push("");
  lines.push("  *********");
  lines.push("  Run Setup");
  lines.push("  *********");
  lines.push(`  Number of subcatchments .... 0`);
  lines.push(`  Number of nodes ............ ${built.nodeCount}`);
  lines.push(`  Number of links ............ ${built.conduitCount}`);
  lines.push(`  Flow units ................. user-set`);
  lines.push("");
  lines.push("  *****************");
  lines.push("  Node Depth Summary");
  lines.push("  *****************");
  lines.push("  Node            Avg Depth   Max Depth   Max Inflow");
  lines.push("  --------------------------------------------------");
  for (const r of peakDepthByNode.slice(0, 50)) {
    lines.push(
      `  ${String(r.n).padEnd(15)} ${(r.d * 0.5).toFixed(3).padStart(9)} ${r.d
        .toFixed(3)
        .padStart(11)} ${r.q.toFixed(3).padStart(12)}`,
    );
  }
  if (peakDepthByNode.length > 50) {
    lines.push(`  ... (${peakDepthByNode.length - 50} more nodes omitted)`);
  }
  lines.push("");
  lines.push("  Analysis ended at: " + new Date().toISOString());
  lines.push(`  Total elapsed time: ${(performance.now() - t0).toFixed(1)} ms (stub)`);
  lines.push("");
  lines.push("  NOTE: real swmm5.wasm not found at /wasm/swmm5.js + /wasm/swmm5.wasm");
  lines.push("        drop in an Emscripten build (MODULARIZE=1 EXPORT_NAME=createSwmmModule)");
  lines.push("        exporting swmm_run(inp, rpt, out) to switch automatically.");
  lines.push(`  Used ${tree.nodes.size} nodes, peak at root accumulates ${totalUp} contributors.`);

  return {
    rpt: lines.join("\n"),
    out: null,
    times,
    series,
    engine: "stub",
    log: `stub run completed in ${(performance.now() - t0).toFixed(1)}ms`,
    durationMs: performance.now() - t0,
  };
}

export async function runEngine(built: BuildResult): Promise<EngineResult> {
  const real = await runWasm(built.inp);
  if (real && real.engine === "wasm" && real.rpt && !real.log.includes("error")) {
    return real;
  }
  return runStub(built, built.inp);
}
