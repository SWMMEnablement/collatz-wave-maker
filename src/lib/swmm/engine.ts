// SWMM5 engine runner.
// Loads the EPA SWMM 5.2.x Emscripten build from /wasm/swmm5.js.

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
  depth: number[];
  velocity: number[];
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
  engine: "wasm";
  log: string;
  durationMs: number;
  exitCode: number | null;
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
    let system: SystemSeries = {
      totalInflow: [], flooding: [], outflow: [], storage: [],
      runoff: [], dwflow: [], rainfall: [],
    };
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
            depth: Array.from(parsed.linkDepth[i]),
            velocity: Array.from(parsed.linkVelocity[i]),
          });

        }
        // system: 0 airTemp, 1 rainfall, 2 snowDepth, 3 infil, 4 runoff,
        // 5 dwflow, 6 gwflow, 7 iiflow, 8 extflow, 9 totalInflow,
        // 10 flooding, 11 outflow, 12 storage, 13 evap, 14 ptlEvap
        system = {
          rainfall: Array.from(parsed.sysVars[1]),
          runoff: Array.from(parsed.sysVars[4]),
          dwflow: Array.from(parsed.sysVars[5]),
          totalInflow: Array.from(parsed.sysVars[9]),
          flooding: Array.from(parsed.sysVars[10]),
          outflow: Array.from(parsed.sysVars[11]),
          storage: Array.from(parsed.sysVars[12]),
        };
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
      system,
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
      exitCode: rc,
    };
  } catch (e) {
    log.push("wasm error: " + (e as Error).message);
    return {
      rpt: "",
      out: null,
      times: [],
      series: [],
      links: [],
      system: {
        totalInflow: [], flooding: [], outflow: [], storage: [],
        runoff: [], dwflow: [], rainfall: [],
      },
      engine: "wasm",
      log: log.join("\n"),
      durationMs: performance.now() - t0,
      exitCode: null,
    };
  } finally {
    if (origPrint) (mod as unknown as { print: (s: string) => void }).print = origPrint;
  }
}

export async function runEngine(built: BuildResult): Promise<EngineResult> {
  const real = await runWasm(built);
  if (real && real.engine === "wasm" && real.rpt) {
    return real;
  }
  throw new Error(real?.log || "EPA SWMM5 WASM engine did not produce a report.");
}

// -----------------------------------------------------------------------------
// Cancelable Web Worker runner with progress reporting.
// -----------------------------------------------------------------------------

export interface EngineRunHandle {
  promise: Promise<EngineResult>;
  cancel: () => void;
}

export interface EngineRunCallbacks {
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
}

function parseOutBufferToResult(
  built: BuildResult,
  rpt: string,
  outBuf: ArrayBuffer | null,
  durationMs: number,
  logLines: string[],
  exitCode: number | null,
): EngineResult {
  const times: number[] = [];
  const series: NodeSeries[] = [];
  const links: LinkSeries[] = [];
  let system: SystemSeries = {
    totalInflow: [], flooding: [], outflow: [], storage: [],
    runoff: [], dwflow: [], rainfall: [],
  };
  let out: Uint8Array | null = null;
  if (outBuf) {
    out = new Uint8Array(outBuf);
    const parsed = parseSwmmOut(out);
    if (parsed) {
      logLines.push(
        `parsed .out: ${parsed.nPeriods} periods, ${parsed.nodeIds.length} nodes, ${parsed.linkIds.length} links, errorCode=${parsed.errorCode}`,
      );
      for (const t of parsed.times) times.push(t);
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
          depth: Array.from(parsed.linkDepth[i]),
          velocity: Array.from(parsed.linkVelocity[i]),
        });

      }
      system = {
        rainfall: Array.from(parsed.sysVars[1]),
        runoff: Array.from(parsed.sysVars[4]),
        dwflow: Array.from(parsed.sysVars[5]),
        totalInflow: Array.from(parsed.sysVars[9]),
        flooding: Array.from(parsed.sysVars[10]),
        outflow: Array.from(parsed.sysVars[11]),
        storage: Array.from(parsed.sysVars[12]),
      };
    } else {
      logLines.push("parse .out failed (magic / layout mismatch)");
    }
  }
  return {
    rpt,
    out,
    times,
    series,
    links,
    system,
    engine: "wasm",
    log: logLines.join("\n"),
    durationMs,
  };
}

export function startEngine(built: BuildResult, cb: EngineRunCallbacks = {}): EngineRunHandle {
  let cancelled = false;
  let worker: Worker | null = null;

  const promise = new Promise<EngineResult>((resolve, reject) => {
    try {
      worker = new Worker(new URL("./engine.worker.ts", import.meta.url));
    } catch (e) {
      // Worker unsupported → run on the main thread.
      runEngine(built).then(resolve, reject);
      return;
    }
    const logLines: string[] = [];
    const t0 = performance.now();
    worker.onmessage = (ev: MessageEvent) => {
      if (cancelled) return;
      const msg = ev.data as
        | { type: "progress"; pct: number }
        | { type: "log"; line: string }
        | { type: "no-wasm" }
        | { type: "error"; message: string }
        | { type: "done"; rc: number; rpt: string; out: ArrayBuffer | null; durationMs: number };
      if (msg.type === "progress") {
        cb.onProgress?.(msg.pct);
      } else if (msg.type === "log") {
        logLines.push(msg.line);
        cb.onLog?.(msg.line);
      } else if (msg.type === "no-wasm") {
        worker?.terminate();
        worker = null;
        reject(new Error("EPA SWMM5 WASM asset was not found at /wasm/swmm5.js."));
      } else if (msg.type === "error") {
        logLines.push("worker error: " + msg.message);
        worker?.terminate();
        worker = null;
        reject(new Error("EPA SWMM5 WASM worker failed: " + msg.message));
      } else if (msg.type === "done") {
        logLines.push(`swmm_run returned ${msg.rc}`);
        const result = parseOutBufferToResult(built, msg.rpt, msg.out, msg.durationMs || (performance.now() - t0), logLines);
        worker?.terminate();
        worker = null;
        cb.onProgress?.(100);
        resolve(result);
      }
    };
    worker.onerror = (ev) => {
      logLines.push("worker onerror: " + ev.message);
      worker?.terminate();
      worker = null;
      reject(new Error("EPA SWMM5 WASM worker failed: " + ev.message));
    };
    worker.postMessage({ inp: built.inp });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
    },
  };
}

