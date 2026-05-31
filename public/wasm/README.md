# SWMM5 WASM engine slot

Drop an Emscripten build of EPA SWMM5 here as:

- `swmm5.js`   — glue, built with `-sMODULARIZE=1 -sEXPORT_NAME=createSwmmModule -sEXPORT_ES6=0 -sENVIRONMENT=web`
- `swmm5.wasm` — the binary

The glue must export `createSwmmModule` on `window` (UMD mode).

The runner in `src/lib/swmm/engine.ts` will:

1. probe `/wasm/swmm5.js` (HEAD)
2. inject the script, await `window.createSwmmModule({ locateFile })`
3. write the generated .inp to MEMFS at `/input.inp`
4. call either `cwrap("swmm_run","number",["string","string","string"])`
   or `callMain([...])` with `(/input.inp, /report.rpt, /output.out)`
5. read `/report.rpt` back as the RPT text, and `/output.out` as a binary blob

If those files are not present, the UI falls back to a stub engine that
generates a synthetic report and per-node depth time series so every tab
(Run / RPT / Graphics) stays usable.
