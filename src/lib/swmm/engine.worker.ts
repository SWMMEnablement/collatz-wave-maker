/// <reference lib="webworker" />
// Classic Web Worker that runs the SWMM5 wasm without blocking the UI.
// Loaded from engine.ts via `new Worker(new URL('./engine.worker.ts', import.meta.url))`.

type W = typeof self & {
  importScripts: (...urls: string[]) => void;
  createSwmmModule?: (opts?: Record<string, unknown>) => Promise<{
    FS: {
      writeFile: (p: string, d: string | Uint8Array) => void;
      readFile: (p: string, o?: { encoding?: "utf8" | "binary" }) => string | Uint8Array;
      unlink?: (p: string) => void;
    };
    cwrap?: (name: string, ret: string, args: string[]) => (...a: unknown[]) => unknown;
  }>;
};

const ctx = self as unknown as W;

ctx.onmessage = async (ev: MessageEvent) => {
  const { inp } = ev.data as { inp: string };
  const t0 = performance.now();
  try {
    const probe = await fetch("/wasm/swmm5.js", { method: "HEAD" });
    if (!probe.ok) {
      ctx.postMessage({ type: "no-wasm" });
      return;
    }
    ctx.importScripts("/wasm/swmm5.js");
    if (!ctx.createSwmmModule) {
      ctx.postMessage({ type: "no-wasm" });
      return;
    }
    const mod = await ctx.createSwmmModule({
      locateFile: (p: string) => "/wasm/" + p,
      print: (s: string) => {
        ctx.postMessage({ type: "log", line: s });
        const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(s);
        if (m) {
          const pct = Math.max(0, Math.min(100, Number(m[1])));
          ctx.postMessage({ type: "progress", pct });
        }
      },
      printErr: (s: string) => ctx.postMessage({ type: "log", line: s }),
    });
    try { mod.FS.unlink?.("/report.rpt"); } catch { /* ignore */ }
    try { mod.FS.unlink?.("/output.out"); } catch { /* ignore */ }
    mod.FS.writeFile("/input.inp", inp);
    const runner = mod.cwrap?.("swmm_run", "number", ["string", "string", "string"]);
    if (!runner) throw new Error("swmm_run not exported");
    const rc = Number(runner("/input.inp", "/report.rpt", "/output.out"));
    let rpt = "";
    let out: Uint8Array | null = null;
    try { rpt = mod.FS.readFile("/report.rpt", { encoding: "utf8" }) as string; } catch { /* ignore */ }
    try { out = mod.FS.readFile("/output.out") as Uint8Array; } catch { /* ignore */ }
    const buf = out ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) : null;
    ctx.postMessage(
      { type: "done", rc, rpt, out: buf, durationMs: performance.now() - t0 },
      buf ? [buf] : [],
    );
  } catch (e) {
    ctx.postMessage({ type: "error", message: (e as Error).message });
  }
};
