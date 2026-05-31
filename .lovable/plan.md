## Collatz → SWMM5 INP Generator

A single-page tool that builds a "Holy Tree" SWMM5 network from Collatz sequences and exports a valid `.inp` file. Includes a stub WASM-style runner placeholder so the engine slot is wired up and ready to swap for a real `swmm5.wasm` later.

### User flow

1. User sets parameters (range, units, geometry defaults).
2. App computes Collatz transitions for all integers 1..N.
3. App generates a SWMM5 `.inp` text following EPA SWMM5 format.
4. Preview pane shows the first ~200 lines + stats (junction count, conduit count).
5. Download button saves `collatz_holy_tree.inp`.

### Inputs (UI)

- **Max seed N** (slider, 2–2000, default 100)
- **Flow units** (CFS / LPS / CMS)
- **Outfall node** (auto: node `1` becomes the outfall — every Collatz sequence ends at 1)
- **Junction defaults**: invert elevation base, max depth
- **Conduit defaults**: length, roughness (Manning's n), geometry (circular diameter)
- **Coordinates**: simple radial/tree layout computed from each integer's depth in the tree (distance from 1)

### .inp sections generated

```
[TITLE]
[OPTIONS]            FLOW_UNITS, INFILTRATION, FLOW_ROUTING, START/END times, step sizes
[JUNCTIONS]          one per unique integer (excluding 1)
[OUTFALLS]           integer 1
[CONDUITS]           one per Collatz transition n -> next(n)
[XSECTIONS]          CIRCULAR, default diameter
[COORDINATES]        x,y per node (tree layout)
[REPORT]             INPUT YES, CONTROLS NO, NODES ALL, LINKS ALL
```

Elevations slope downhill toward node 1 so the network is hydraulically valid (depth-in-tree determines invert).

### Engine slot (stub)

- `src/lib/swmm/engine.ts` exports `runSwmm(inpText): Promise<{ ok: boolean; message: string }>`.
- Current implementation: returns `{ ok: false, message: "WASM engine not loaded. Drop swmm5.wasm into /public/wasm/ to enable simulation." }`.
- `/public/wasm/README.md` documents the expected file + exported symbols so a real EPA SWMM5 Emscripten build can be dropped in later without UI changes.
- No "Run" button in the UI for now (scope = generate + download only), but the engine module exists so the wiring is ready.

### Visual design

Dark theme inspired by the reference image: near-black background, amber/orange accents (the "Holy Tree" color), monospace for the .inp preview, generous whitespace. Single-screen layout: controls on the left, live preview + download on the right. No charts, no topology render (per scope answer).

### Files

- `src/routes/index.tsx` — page (replaces placeholder)
- `src/lib/collatz.ts` — sequence + tree builder
- `src/lib/swmm/inp.ts` — .inp string builder
- `src/lib/swmm/layout.ts` — node coordinate layout
- `src/lib/swmm/engine.ts` — WASM engine stub interface
- `src/components/GeneratorForm.tsx`, `InpPreview.tsx`
- `src/styles.css` — dark amber tokens
- `public/wasm/README.md` — instructions for adding real swmm5.wasm

### Out of scope (per your answers)

- Running the simulation in-browser
- Topology visualization
- Single-seed mode
- Compiling EPA SWMM5 to WASM
