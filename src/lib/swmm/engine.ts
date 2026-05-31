// Stub WASM engine slot. Drop a real swmm5.wasm + glue under /public/wasm/
// and replace the body of runSwmm() to instantiate and invoke it.

export interface SwmmRunResult {
  ok: boolean;
  message: string;
  reportText?: string;
}

export async function runSwmm(_inpText: string): Promise<SwmmRunResult> {
  return {
    ok: false,
    message:
      "WASM SWMM5 engine not loaded. Drop swmm5.wasm into /public/wasm/ to enable simulation.",
  };
}
