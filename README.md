# Collatz Wave Maker

> README added by Robert Dickinson via Comet. Written from the repository source (`src/lib/collatz.ts`, `src/lib/swmm/*`, `package.json`).

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript badge" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite badge" />
  <img src="https://img.shields.io/badge/TanStack_Start-FF4154?style=for-the-badge&logo=react&logoColor=white" alt="TanStack Start badge" />
  <img src="https://img.shields.io/badge/WebAssembly-654FF0?style=for-the-badge&logo=webassembly&logoColor=white" alt="WebAssembly badge" />
  <img src="https://img.shields.io/badge/Recharts-22B5BF?style=for-the-badge" alt="Recharts badge" />
</p>

## About

**Collatz Wave Maker** turns the **Collatz (3n+1) conjecture** into a runnable **EPA SWMM5 stormwater model** entirely in the browser. It generates Collatz sequences, assembles them into a tree, maps that tree onto a SWMM drainage network, runs a real WebAssembly build of the SWMM5 engine, and plots the resulting hydraulic time series as animated "waves."

The pipeline is:

1. **Collatz math** – for every seed up to `maxSeed`, repeatedly apply `n -> n/2` (even) or `n -> 3n+1` (odd) until reaching 1, building a tree where every number flows toward 1.
2. **Network mapping** – each number becomes a SWMM junction, each Collatz step `n -> next(n)` becomes a conduit directed toward 1 (the outfall). Distance from 1 sets node depth/invert.
3. **`.inp` generation** – a complete SWMM5 input file is written with `[JUNCTIONS]`, `[CONDUITS]`, `[DWF]`, `[INFLOWS]`, coordinates, and more.
4. **Simulation** – a real Emscripten-compiled SWMM5 engine (`/public/wasm/swmm5.js` + `swmm5.wasm`) runs the model in-browser, with a synthetic stub as fallback if the WASM fails to load.
5. **Visualization** – SWMM binary output is parsed into per-node and per-link time series (depth, inflow, flow) and rendered as charts with Recharts.

This project is part of the SWMMEnablement collection.

## What the App Produces

The "waves" are SWMM **time-series results** for the synthesized Collatz network: water depth and inflow at each node and flow in each conduit at every simulation timestep. Because the network topology is derived from the branching structure of Collatz sequences, different seeds and parameters produce visibly different hydraulic responses.

## What's Inside

| Path | Description |
| --- | --- |
| `src/lib/collatz.ts` | Core math: `nextCollatz`, `sequence(seed)`, and `buildTree(maxSeed)` (nodes, edges, BFS depth from 1) |
| `src/lib/swmm/inp.ts` | `buildInp(opts)` – writes the SWMM5 `.inp` file from the Collatz tree and `InpOptions` |
| `src/lib/swmm/layout.ts` | Computes node coordinates for the network (`layoutFor`, `LayoutMode`) |
| `src/lib/swmm/engine.ts` | Loads and runs the WASM SWMM5 engine; defines `NodeSeries` / `LinkSeries` / `SystemSeries` |
| `src/lib/swmm/outfile.ts` | Parses the SWMM binary output file into time series (`parseSwmmOut`) |
| `src/routes/` | TanStack Start route/page components (UI) |
| `src/components/` | UI components, including Recharts-based plots and shadcn/ui controls |
| `public/wasm/` | Emscripten-compiled `swmm5.js` and `swmm5.wasm` |

## Parameters (`InpOptions`)

Defined in `src/lib/swmm/inp.ts`:

| Option | Meaning |
| --- | --- |
| `maxSeed` | Largest Collatz seed; controls how many junctions/conduits the network has |
| `flowUnits` | SWMM flow units: `CFS`, `LPS`, or `CMS` |
| `baseInvert` | Invert elevation of the outfall/base node |
| `invertDrop` | Elevation drop applied per depth step toward the outfall |
| `maxDepth` | Maximum node depth |
| `conduitLength` | Length assigned to each conduit |
| `roughness` | Manning's roughness for conduits |
| `diameter` | Conduit diameter |
| `layoutMode` | Layout algorithm used to place nodes |
| `dwfBaseflow` | **Dry Weather Flow** – average baseflow assigned to each junction |
| `dwfPattern` | Optional DWF time pattern name (`""` = none) |
| `endTimeSec` | Simulation duration in seconds (min 12 h = 43200) |
| `peakInflow` | Peak of the trapezoidal inflow hydrograph at each junction |
| `coordScale` | Multiplier applied to all node x/y coordinates |

## Tech Stack

- **Framework:** TanStack Start (React + TypeScript), based on the `tanstack_start_ts` template
- **Build/Dev:** Vite, Bun
- **UI:** Tailwind CSS, shadcn/ui (Radix UI), `react-hook-form`
- **Charts:** Recharts
- **Validation:** Zod
- **Simulation:** EPA SWMM5 compiled to WebAssembly (Emscripten)

## Getting Started

Scripts are defined in `package.json`:

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev          # vite dev

# Production build / preview
bun run build        # vite build
bun run preview      # vite preview

# Lint / format
bun run lint         # eslint .
bun run format       # prettier --write .
```

Then open the local URL printed by Vite in your browser.

## Notes

- The SWMM5 engine runs client-side via WebAssembly; no server is required for simulation. If the WASM build cannot be loaded, `engine.ts` falls back to a synthetic stub so the UI still renders.
- This is an experimental / educational project connecting number theory (Collatz) to hydraulic modeling (SWMM5).

## License

No license file is currently present in the repository. Add one to clarify reuse terms.
