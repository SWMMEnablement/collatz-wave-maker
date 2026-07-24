// Engine provenance — pins the exact SWMM WASM build, computes its SHA-256,
// and packages it into a stable "manifest" object that gets embedded in the
// run manifest download and rendered on the Engine tab.

export interface EngineProvenance {
  engineName: string;      // "EPA SWMM"
  engineVersion: string;   // pinned upstream version
  packageName: string;     // npm package that shipped the wasm
  packageVersion: string;  // pinned package version
  wrapperCommit: string;   // this project's wrapper revision
  assetPath: string;       // where the browser fetched it
  assetBytes: number | null;
  assetSha256: string | null;
  status: "ready" | "missing" | "checking" | "error";
  error?: string;
}

// Pinned build metadata. Update deliberately when a new WASM asset is vendored.
export const ENGINE_PINS = {
  engineName: "EPA SWMM",
  engineVersion: "5.2.4",
  packageName: "@fileops/swmm-wasm",
  packageVersion: "0.0.5 (browser-adapted)",
  wrapperCommit: "collatz-swmm.v1",
  assetPath: "/wasm/swmm5.js",
} as const;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

let cached: EngineProvenance | null = null;

export async function getEngineProvenance(): Promise<EngineProvenance> {
  if (cached && cached.status === "ready") return cached;
  const base: EngineProvenance = {
    ...ENGINE_PINS,
    assetBytes: null,
    assetSha256: null,
    status: "checking",
  };
  try {
    const res = await fetch(ENGINE_PINS.assetPath, { cache: "force-cache" });
    if (!res.ok) {
      cached = { ...base, status: "missing" };
      return cached;
    }
    const buf = await res.arrayBuffer();
    const sha = await sha256Hex(buf).catch(() => "");
    cached = {
      ...base,
      assetBytes: buf.byteLength,
      assetSha256: sha || null,
      status: "ready",
    };
    return cached;
  } catch (e) {
    cached = { ...base, status: "error", error: (e as Error).message };
    return cached;
  }
}

export function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export function shortHash(h: string | null, n = 12): string {
  if (!h) return "—";
  return h.length > n ? h.slice(0, n) + "…" : h;
}
