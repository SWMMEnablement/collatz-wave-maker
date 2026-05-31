# SWMM5 WASM engine slot

Place a browser-compatible Emscripten build of EPA SWMM5 here as
`swmm5.wasm` (plus its `swmm5.js` glue if applicable).

Then update `src/lib/swmm/engine.ts` to instantiate the module and call
`swmm_run(inpPath, rptPath, outPath)` against an in-memory FS (MEMFS).

The generator UI is engine-agnostic — no UI changes required.
