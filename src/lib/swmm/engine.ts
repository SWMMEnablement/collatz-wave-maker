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

export interface LinkSeries {
  id: string;
  from: number;
  to: number;
  flow: number[];
}

export interface SystemSeries {
  totalInflow: number[];
  flooding: number[];
  outflow: number[];
  storage: number[];
  runoff: number[];
  dwflow: number[];
  rainfall: number[];
}

export interface EngineResult {
  rpt: string;
  out: Uint8Array | null;
  times: number[]; // minutes
  series: NodeSeries[];
  links: LinkSeries[];
  system: SystemSeries;
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
        print: (s: string) => console.log("[swmm]", s),
        printErr: (s: string) => console.warn("[swmm]", s),
      });
      return mod;
    } catch {
      return null;
    }
  })();
  return modulePromise;
}

async function runWasm(built: BuildResult): Promise<EngineResult | null> {
  const mod = await loadWasmModule();
  if (!mod) return null;
  const t0 = performance.now();
  const log: string[] = [];
  const stdout: string[] = [];
  // Capture print output for this run.
  const origPrint = (mod as unknown as { print?: (s: string) => void }).print;
  (mod as unknown as { print: (s: string) => void }).print = (s: string) => {
    stdout.push(s);
  };
  try {
    mod.FS.writeFile("/input.inp", built.inp);
    // Pre-create empty files so swmm_run can open them for writing.
    try { mod.FS.unlink?.("/report.rpt"); } catch { /* ignore */ }
    try { mod.FS.unlink?.("/output.out"); } catch { /* ignore */ }

    const runner = mod.cwrap?.("swmm_run", "number", ["string", "string", "string"]);
    let rc = -1;
    if (runner) {
      rc = Number(runner("/input.inp", "/report.rpt", "/output.out"));
    } else {
      throw new Error("swmm_run not exported");
    }
    log.push(`swmm_run returned ${rc}`);

    // Pull error string if any.
    if (rc !== 0) {
      const getErr = mod.cwrap?.("swmm_getError", "number", ["number", "number"]);
      if (getErr) {
        const len = 256;
        const ptr = (mod as unknown as { _malloc: (n: number) => number })._malloc(len);
        try {
          getErr(ptr, len);
          const HEAPU8 = (mod as unknown as { HEAPU8: Uint8Array }).HEAPU8;
          let s = "";
          for (let i = 0; i < len; i++) {
            const c = HEAPU8[ptr + i];
            if (!c) break;
            s += String.fromCharCode(c);
          }
          if (s) log.push("error: " + s);
        } finally {
          (mod as unknown as { _free: (p: number) => void })._free(ptr);
        }
      }
    }

    let rpt = "";
    try {
      rpt = mod.FS.readFile("/report.rpt", { encoding: "utf8" }) as string;
    } catch (e) {
      log.push("read rpt failed: " + (e as Error).message);
    }

    let out: Uint8Array | null = null;
    const times: number[] = [];
    const series: NodeSeries[] = [];
    const links: LinkSeries[] = [];
    try {
      out = mod.FS.readFile("/output.out") as Uint8Array;
      const parsed = parseSwmmOut(out);
      if (parsed) {
        log.push(
          `parsed .out: ${parsed.nPeriods} periods, ${parsed.nodeIds.length} nodes, ${parsed.linkIds.length} links, errorCode=${parsed.errorCode}`,
        );
        for (let i = 0; i < parsed.times.length; i++) times.push(parsed.times[i]);
        for (let i = 0; i < parsed.nodeIds.length; i++) {
          const id = parsed.nodeIds[i];
          const m = /^N?(\d+)$/.exec(id);
          const node = m ? Number(m[1]) : i + 1;
          series.push({
            node,
            depth: Array.from(parsed.nodeDepth[i]),
            inflow: Array.from(parsed.nodeTotalInflow[i]),
          });
        }
        // map link id "C{cid}" back to from/to using built.tree.edges order
        const edges = Array.from(built.tree.edges.entries());
        for (let i = 0; i < parsed.linkIds.length; i++) {
          const id = parsed.linkIds[i];
          const m = /^C(\d+)$/.exec(id);
          const idx = m ? Number(m[1]) - 1 : i;
          const e = edges[idx];
          links.push({
            id,
            from: e ? e[0] : -1,
            to: e ? e[1] : -1,
            flow: Array.from(parsed.linkFlow[i]),
          });
        }
      } else {
        log.push("parse .out failed (magic / layout mismatch)");
      }
    } catch (e) {
      log.push("read out failed: " + (e as Error).message);
    }

    if (stdout.length) log.push("--- stdout ---", ...stdout);

    return {
      rpt,
      out,
      times,
      series,
      links,
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
    };
  } catch (e) {
    log.push("wasm error: " + (e as Error).message);
    return {
      rpt: "",
      out: null,
      times: [],
      series: [],
      links: [],
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
    };
  } finally {
    if (origPrint) (mod as unknown as { print: (s: string) => void }).print = origPrint;
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

  // Use a reporting step of 5 min; derive period count from endTimeSec when present.
  const endSec = built.endTimeSec || 21600;
  const stepSec = 300;
  const N = Math.max(2, Math.floor(endSec / stepSec) + 1);
  const peakMin = endSec / 60 / 3; // peak ~1/3 into sim
  const times: number[] = [];
  const wave: number[] = [];
  for (let i = 0; i < N; i++) {
    const m = i * (stepSec / 60);
    times.push(m);
    const x = (m - peakMin) / Math.max(30, peakMin / 2);
    wave.push(Math.exp(-x * x * 0.6));
  }

  const baseflow = 0.1;
  const series: NodeSeries[] = [];
  const totalUp = upstream.get(1) ?? 1;
  const inflowByNode = new Map<number, number[]>();
  for (const n of tree.nodes) {
    const up = upstream.get(n) ?? 1;
    const peakQ = baseflow * up;
    const inflow = wave.map((w) => +(peakQ * (0.3 + 0.7 * w)).toFixed(4));
    const cap = built.inverts.get(n) !== undefined ? 10 : 10;
    const depth = inflow.map((q) =>
      +Math.min(cap, Math.log10(1 + q) * 1.5).toFixed(4),
    );
    series.push({ node: n, depth, inflow });
    inflowByNode.set(n, inflow);
  }

  // synthesize link flows: flow in conduit ≈ from-node inflow
  const links: LinkSeries[] = [];
  let cid = 0;
  for (const [from, to] of tree.edges) {
    cid++;
    const flow = inflowByNode.get(from) ?? wave.map(() => 0);
    links.push({ id: "C" + cid, from, to, flow: flow.slice() });
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
    links,
    engine: "stub",
    log: `stub run completed in ${(performance.now() - t0).toFixed(1)}ms`,
    durationMs: performance.now() - t0,
  };
}

export async function runEngine(built: BuildResult): Promise<EngineResult> {
  const real = await runWasm(built);
  if (real && real.engine === "wasm" && real.rpt) {
    return real;
  }
  return runStub(built, built.inp);
}
