# SWMM5 WASM engine

`swmm5.js` in this folder is the Emscripten single-file build of EPA SWMM 5.2.x
distributed as `@fileops/swmm-wasm` on npm. It embeds the `.wasm` binary as a
data URI, so no separate `swmm5.wasm` is required.

The upstream module is exported globally as `createModule`; the last line of
this vendored copy aliases it to `self.createSwmmModule` so the worker in
`src/lib/swmm/engine.worker.ts` can pick it up unchanged.

Exports (via `cwrap`):
- `swmm_run(inp, rpt, out)` — one-shot run, returns error code
- `swmm_open`, `swmm_start`, `swmm_step`, `swmm_end`, `swmm_report`, `swmm_close`

Source: <https://www.npmjs.com/package/@fileops/swmm-wasm>
