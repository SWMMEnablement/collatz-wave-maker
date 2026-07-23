import { buildTree, type CollatzTree } from "../collatz";
import { layoutFor, type LayoutMode } from "./layout";

export type StormType = "none" | "uniform" | "scs-type-ii" | "alt-block";

export const STORM_OPTIONS: { value: StormType; label: string; description: string }[] = [
  { value: "none",        label: "None (trapezoidal inflows only)", description: "Skip rainfall — junctions receive the trapezoidal INFLOW hydrograph only." },
  { value: "uniform",     label: "Uniform hyetograph",              description: "Constant intensity over the storm duration." },
  { value: "scs-type-ii", label: "SCS Type II (24-hr)",             description: "NRCS Type II cumulative distribution, scaled to duration + depth." },
  { value: "alt-block",   label: "Alternating block (IDF)",         description: "Chicago-style alternating block from a simple IDF envelope." },
];

export type InflowScope = "seeds" | "leaves" | "all";
export type SubAreaMode = "per-sub" | "fixed-total";

export interface InpOptions {
  maxSeed: number;
  flowUnits: "CFS" | "LPS" | "CMS";
  baseInvert: number;
  invertDrop: number;
  maxDepth: number;
  conduitLength: number;
  roughness: number;
  diameter: number;
  layoutMode: LayoutMode;
  dwfBaseflow: number;
  dwfPattern: string;
  endTimeSec: number;
  peakInflow: number;
  coordScale: number;
  progressiveSizing: boolean;
  maxDiameterMultiplier: number;
  trapRiseFrac: number;
  trapPlateauFrac: number;
  trapFallFrac: number;

  /** Which nodes receive the trapezoidal INFLOW hydrograph. */
  inflowScope: InflowScope;

  stormType: StormType;
  stormDepth: number;
  stormDurationHr: number;
  rainIntervalMin: number;

  subcatchments: boolean;
  /** Which nodes get an auto-generated subcatchment. */
  subcatchmentScope: InflowScope;
  /** Per-sub area, or a fixed total watershed area split evenly across subs. */
  subAreaMode: SubAreaMode;
  subcatchmentArea: number;
  subTotalArea: number;
  imperviousPct: number;
  subWidth: number;
  subSlope: number;
}

export type TrapezoidPresetKey =
  | "symmetric"
  | "storm-burst"
  | "slow-build"
  | "flash-flood"
  | "long-plateau"
  | "custom";

export interface TrapezoidPreset {
  key: TrapezoidPresetKey;
  label: string;
  description: string;
  rise: number;
  plateau: number;
  fall: number;
}

export const TRAPEZOID_PRESETS: TrapezoidPreset[] = [
  { key: "symmetric",    label: "Symmetric",       description: "25% rise · 50% plateau · 25% fall", rise: 0.25, plateau: 0.5,  fall: 0.25 },
  { key: "storm-burst",  label: "Storm burst",     description: "10% rise · 20% plateau · 70% fall", rise: 0.10, plateau: 0.2,  fall: 0.70 },
  { key: "slow-build",   label: "Slow build",      description: "40% rise · 20% plateau · 40% fall", rise: 0.40, plateau: 0.2,  fall: 0.40 },
  { key: "flash-flood",  label: "Flash flood",     description: "5% rise · 10% plateau · 85% fall",  rise: 0.05, plateau: 0.10, fall: 0.85 },
  { key: "long-plateau", label: "Long plateau",    description: "10% rise · 80% plateau · 10% fall", rise: 0.10, plateau: 0.80, fall: 0.10 },
];

export function detectTrapezoidPreset(opts: Pick<InpOptions, "trapRiseFrac" | "trapPlateauFrac" | "trapFallFrac">): TrapezoidPresetKey {
  for (const p of TRAPEZOID_PRESETS) {
    if (
      Math.abs(p.rise - opts.trapRiseFrac) < 1e-3 &&
      Math.abs(p.plateau - opts.trapPlateauFrac) < 1e-3 &&
      Math.abs(p.fall - opts.trapFallFrac) < 1e-3
    ) return p.key;
  }
  return "custom";
}

export const defaultOptions: InpOptions = {
  maxSeed: 100,
  flowUnits: "CFS",
  baseInvert: 0,
  invertDrop: 1,
  maxDepth: 10,
  conduitLength: 400,
  roughness: 0.013,
  diameter: 1.0,
  layoutMode: "symmetric",
  dwfBaseflow: 0,
  dwfPattern: "",
  endTimeSec: 43200, // 12 hours
  peakInflow: 1.0,
  coordScale: 0.05,
  progressiveSizing: false,
  maxDiameterMultiplier: 6,
  trapRiseFrac: 0.25,
  trapPlateauFrac: 0.5,
  trapFallFrac: 0.25,

  inflowScope: "seeds",

  stormType: "none",
  stormDepth: 2.0,
  stormDurationHr: 6,
  rainIntervalMin: 15,

  subcatchments: false,
  subcatchmentScope: "seeds",
  subAreaMode: "fixed-total",
  subcatchmentArea: 1.0,
  subTotalArea: 100,
  imperviousPct: 40,
  subWidth: 500,
  subSlope: 1.0,
};


function secsToHMS(s: number): string {
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(ss)}`;
}

// ============================================================
// Storm hyetograph builders
// ============================================================

// NRCS SCS Type II 24-hr cumulative distribution (fraction of total P).
// Reference: NRCS TR-55 Appendix B. Time normalized to 24 h.
const SCS_TYPE_II: Array<[number, number]> = ([
  [0.000, 0.000], [0.083, 0.011], [0.167, 0.022], [0.250, 0.035],
  [0.333, 0.048], [0.417, 0.064], [0.458, 0.075], [0.479, 0.089],
  [0.490, 0.120], [0.495, 0.180], [0.500, 0.400], [0.510, 0.560],
  [0.521, 0.635], [0.542, 0.720], [0.583, 0.800], [0.625, 0.845],
  [0.667, 0.878], [0.708, 0.902], [0.750, 0.922], [0.792, 0.940],
  [0.833, 0.955], [0.875, 0.967], [0.917, 0.977], [0.958, 0.989],
  [1.000, 1.000],
] as Array<[number, number]>).sort((a, b) => a[0] - b[0]);

function interpCumulative(table: Array<[number, number]>, x: number): number {
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) {
      if (x1 === x0) return y1;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Build a rainfall hyetograph as (minuteOffset, intensity) pairs.
 * Intensity units are per hour (in/hr for US, mm/hr for SI).
 * Returns [] if stormType === "none" or if depth/duration are non-positive.
 */
export function buildStormHyetograph(opts: InpOptions): Array<[number, number]> {
  if (opts.stormType === "none") return [];
  const depth = opts.stormDepth;
  const durH = opts.stormDurationHr;
  const step = Math.max(1, opts.rainIntervalMin);
  if (depth <= 0 || durH <= 0) return [];
  const nSteps = Math.max(1, Math.floor((durH * 60) / step));
  const out: Array<[number, number]> = [];
  const dtH = step / 60;

  if (opts.stormType === "uniform") {
    const intensity = depth / durH; // per hour
    for (let i = 0; i < nSteps; i++) out.push([i * step, intensity]);
    return out;
  }

  if (opts.stormType === "scs-type-ii") {
    // Scale the 24-hr table so that time 0..1 spans the user duration.
    let prevCum = 0;
    for (let i = 0; i < nSteps; i++) {
      const tEnd = ((i + 1) * step) / (durH * 60); // 0..1
      const cum = interpCumulative(SCS_TYPE_II, tEnd) * depth;
      const inc = Math.max(0, cum - prevCum);
      prevCum = cum;
      out.push([i * step, inc / dtH]);
    }
    return out;
  }

  // Alternating block (Chicago) from simple IDF: i(d) = a / (d + b)^n
  // Choose a,b,n so cumulative over durH equals depth.
  const n = 0.75;
  const b = 10; // minutes
  // Compute normalization so integrated i(t) dt over 0..durH == depth
  // Using average intensity from the IDF at increasing durations.
  const iOfDurMin = (d: number, A: number) => A / Math.pow(d + b, n); // in/hr
  // Solve A: sum over ranked intervals * dtH == depth
  const ranked: number[] = [];
  for (let k = 1; k <= nSteps; k++) {
    const d = k * step;
    const totalDepth = iOfDurMin(d, 1) * (d / 60); // depth for 1-normalized A
    const prevDepth = k === 1 ? 0 : iOfDurMin((k - 1) * step, 1) * ((k - 1) * step / 60);
    ranked.push(Math.max(1e-9, totalDepth - prevDepth));
  }
  const unitDepthSum = ranked.reduce((s, v) => s + v, 0);
  const A = depth / Math.max(1e-9, unitDepthSum);
  const blocks = ranked.map((v) => (v * A) / dtH); // convert incremental depth → intensity

  // Alternating placement around center
  const arranged = new Array<number>(nSteps).fill(0);
  const mid = Math.floor(nSteps / 2);
  let left = mid - 1;
  let right = mid;
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) {
      arranged[mid] = blocks[0];
    } else if (i % 2 === 1) {
      if (right + 1 < nSteps) { arranged[right + 1] = blocks[i]; right++; }
      else if (left >= 0) { arranged[left] = blocks[i]; left--; }
    } else {
      if (left >= 0) { arranged[left] = blocks[i]; left--; }
      else if (right + 1 < nSteps) { arranged[right + 1] = blocks[i]; right++; }
    }
  }
  for (let i = 0; i < nSteps; i++) out.push([i * step, arranged[i]]);
  return out;
}

export interface BuildResult {
  inp: string;
  nodeCount: number;
  conduitCount: number;
  tree: CollatzTree;
  coords: Map<number, [number, number]>;
  inverts: Map<number, number>;
  endTimeSec: number;
  upstreamCount: Map<number, number>;
  conduitDiameter: Map<string, number>;
  storm: Array<[number, number]>;
  subcatchmentCount: number;
  /** User seeds actually present in the network (should equal maxSeed). */
  seedCount: number;
  /** Nodes with no upstream neighbours (Collatz-tree leaves, excluding outfall). */
  leafCount: number;
  /** All non-outfall junctions (seeds + intermediate trajectory nodes). */
  generatedCount: number;
  /** Node ids that received the trapezoidal INFLOW hydrograph. */
  inflowNodes: number[];
  /** Node ids that got an auto-generated subcatchment. */
  subcatchmentNodes: number[];
  /** Effective per-sub area in ac/ha after applying subAreaMode. */
  effectiveSubArea: number;
}


const pad = (s: string | number, w: number) => String(s).padEnd(w);

export function buildInp(opts: InpOptions): BuildResult {
  const tree = buildTree(opts.maxSeed);
  const rawCoords = layoutFor(tree, opts.layoutMode);
  const coords = new Map<number, [number, number]>();
  for (const [n, [x, y]] of rawCoords) {
    coords.set(n, [x * opts.coordScale, y * opts.coordScale]);
  }

  const isUS = opts.flowUnits === "CFS";
  const rainUnit = isUS ? "IN" : "MM";
  const storm = buildStormHyetograph(opts);
  const hasStorm = storm.length > 0;
  const hasSubs = opts.subcatchments;

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("[TITLE]");
  push(`Collatz Holy Tree SWMM5 network (seeds 1..${opts.maxSeed})`);
  push("Generated by Collatz SWMM5 INP Generator");
  push();

  push("[OPTIONS]");
  push(`FLOW_UNITS           ${opts.flowUnits}`);
  push("INFILTRATION         HORTON");
  push("FLOW_ROUTING         DYNWAVE");
  push("LINK_OFFSETS         DEPTH");
  push("MIN_SLOPE            0");
  push("ALLOW_PONDING        NO");
  push("SKIP_STEADY_STATE    NO");
  push("START_DATE           01/01/2024");
  push("START_TIME           00:00:00");
  push("REPORT_START_DATE    01/01/2024");
  push("REPORT_START_TIME    00:00:00");
  push("END_DATE             01/01/2024");
  push(`END_TIME             ${secsToHMS(opts.endTimeSec)}`);
  push("SWEEP_START          01/01");
  push("SWEEP_END            12/31");
  push("DRY_DAYS             0");
  push("REPORT_STEP          00:05:00");
  push("WET_STEP             00:05:00");
  push("DRY_STEP             01:00:00");
  push("ROUTING_STEP         0:00:10");
  push("LENGTHENING_STEP     5");
  push("INERTIAL_DAMPING     PARTIAL");
  push("NORMAL_FLOW_LIMITED  BOTH");
  push("VARIABLE_STEP        0.75");
  push("MIN_SURFAREA         12.566");
  push();

  push("[EVAPORATION]");
  push("CONSTANT  0.0");
  push("DRY_ONLY  NO");
  push();

  if (hasStorm) {
    push("[RAINGAGES]");
    push(";;Name           Format    Interval SCF      Source");
    const intervalHMS = secsToHMS(opts.rainIntervalMin * 60).slice(0, 5); // HH:MM
    push(`${pad("RG1", 17)}${pad("INTENSITY", 10)}${pad(intervalHMS, 9)}${pad("1.0", 9)}TIMESERIES STORM`);
    push();
  }

  // invert for a node: deeper-in-tree (further from 1) = higher elevation
  const invertOf = (n: number) =>
    opts.baseInvert + (tree.depth.get(n) ?? 0) * opts.invertDrop;

  // Compute upstream contributing node count (each node contributes itself + all upstream).
  const children = new Map<number, number[]>();
  for (const [from, to] of tree.edges) {
    if (!children.has(to)) children.set(to, []);
    children.get(to)!.push(from);
  }
  const upstreamCount = new Map<number, number>();
  const countUp = (n: number): number => {
    if (upstreamCount.has(n)) return upstreamCount.get(n)!;
    let c = 1;
    for (const ch of children.get(n) ?? []) c += countUp(ch);
    upstreamCount.set(n, c);
    return c;
  };
  for (const n of tree.nodes) countUp(n);

  // Node scope helpers -----------------------------------------------------
  const seedSet = new Set<number>();
  for (let s = 2; s <= opts.maxSeed; s++) if (tree.nodes.has(s)) seedSet.add(s);
  const leafSet = new Set<number>();
  for (const n of tree.nodes) {
    if (n === 1) continue;
    if (!(children.get(n)?.length)) leafSet.add(n);
  }
  const allSet = new Set<number>();
  for (const n of tree.nodes) if (n !== 1) allSet.add(n);

  const scopeSet = (scope: InflowScope) =>
    scope === "seeds" ? seedSet : scope === "leaves" ? leafSet : allSet;

  const inflowSet = scopeSet(opts.inflowScope);
  const subSet = scopeSet(opts.subcatchmentScope);
  const generatedCount = allSet.size;
  const seedCount = seedSet.size;
  const leafCount = leafSet.size;

  // Fixed-total mode splits area evenly across subs; per-sub uses raw value.
  const subNodeCount = subSet.size;
  const effectiveSubArea = opts.subAreaMode === "fixed-total"
    ? (subNodeCount > 0 ? opts.subTotalArea / subNodeCount : 0)
    : opts.subcatchmentArea;


  let subcatchmentCount = 0;
  if (hasSubs) {
    push("[SUBCATCHMENTS]");
    push(";;Name           RainGage         Outlet           Area     %Imperv  Width    %Slope   CurbLen  SnowPack");
    for (const n of tree.nodes) {
      if (!subSet.has(n)) continue;
      subcatchmentCount++;
      push(
        `${pad("S" + n, 17)}${pad("RG1", 17)}${pad(n, 17)}${pad(
          effectiveSubArea.toFixed(3),
          9,
        )}${pad(opts.imperviousPct.toFixed(1), 9)}${pad(
          opts.subWidth.toFixed(1),
          9,
        )}${pad(opts.subSlope.toFixed(2), 9)}${pad("0", 9)}`,
      );
    }
    push();

    push("[SUBAREAS]");
    push(";;Subcatchment   N-Imperv   N-Perv     S-Imperv   S-Perv     PctZero    RouteTo    PctRouted");
    for (const n of tree.nodes) {
      if (!subSet.has(n)) continue;
      push(
        `${pad("S" + n, 17)}${pad("0.013", 11)}${pad("0.10", 11)}${pad(
          "0.05",
          11,
        )}${pad("0.10", 11)}${pad("25", 11)}${pad("OUTLET", 11)}`,
      );
    }
    push();

    push("[INFILTRATION]");
    push(";;Subcatchment   MaxRate    MinRate    Decay      DryTime    MaxInfil");
    for (const n of tree.nodes) {
      if (!subSet.has(n)) continue;
      push(
        `${pad("S" + n, 17)}${pad("3.0", 11)}${pad("0.5", 11)}${pad(
          "4.0",
          11,
        )}${pad("7.0", 11)}${pad("0", 11)}`,
      );
    }
    push();
  }

  push("[JUNCTIONS]");
  push(";;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded");
  for (const n of tree.nodes) {
    if (n === 1) continue;
    push(
      `${pad(n, 17)}${pad(invertOf(n).toFixed(3), 11)}${pad(
        opts.maxDepth,
        11,
      )}${pad(0, 11)}${pad(0, 11)}0`,
    );
  }
  push();

  push("[OUTFALLS]");
  push(";;Name           Elevation  Type       Stage Data        Gated");
  push(`${pad(1, 17)}${pad(opts.baseInvert.toFixed(3), 11)}FREE                            NO`);
  push();

  push("[CONDUITS]");
  push(";;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow");
  const edgeList = Array.from(tree.edges);
  let cid = 0;
  for (const [from, to] of edgeList) {
    cid++;
    push(
      `${pad("C" + cid, 17)}${pad(from, 17)}${pad(to, 17)}${pad(
        opts.conduitLength,
        11,
      )}${pad(opts.roughness, 11)}${pad(0, 11)}${pad(0, 11)}${pad(0, 11)}0`,
    );
  }
  push();

  // Progressive sizing: diameter grows with sqrt of upstream node count on the
  // upstream end of each conduit, capped at maxDiameterMultiplier × base.
  const conduitDiameter = new Map<string, number>();
  const diameterFor = (fromNode: number): number => {
    if (!opts.progressiveSizing) return opts.diameter;
    const up = upstreamCount.get(fromNode) ?? 1;
    const scale = Math.min(opts.maxDiameterMultiplier, Math.sqrt(up));
    return opts.diameter * Math.max(1, scale);
  };

  push("[XSECTIONS]");
  push(";;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels");
  for (let i = 0; i < edgeList.length; i++) {
    const [from] = edgeList[i];
    const dia = diameterFor(from);
    const id = "C" + (i + 1);
    conduitDiameter.set(id, dia);
    push(
      `${pad(id, 17)}${pad("CIRCULAR", 13)}${pad(
        dia.toFixed(3),
        17,
      )}${pad(0, 11)}${pad(0, 11)}${pad(0, 11)}1`,
    );
  }
  push();


  push("[DWF]");
  push(";;Node           Constituent      Baseline   Patterns");
  for (const n of tree.nodes) {
    if (n === 1) continue;
    const pat = opts.dwfPattern.trim();
    push(
      `${pad(n, 17)}${pad("FLOW", 17)}${pad(
        opts.dwfBaseflow.toFixed(4),
        11,
      )}${pat ? `"${pat}"` : ""}`,
    );
  }
  push();

  // Trapezoidal inflow hydrograph applied at every junction
  const tsName = "TRAPZ";
  const endH = opts.endTimeSec / 3600;
  const peak = opts.peakInflow;
  const fmtH = (h: number) => {
    const total = Math.max(0, Math.round(h * 3600));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(hh)}:${p(mm)}:${p(ss)}`;
  };
  push("[INFLOWS]");
  push(";;Node           Constituent      Time Series      Type     Mfactor  Sfactor  Baseline Pattern");
  for (const n of tree.nodes) {
    if (n === 1) continue;
    push(
      `${pad(n, 17)}${pad("FLOW", 17)}${pad(tsName, 17)}${pad("FLOW", 9)}${pad(
        "1.0",
        9,
      )}${pad("1.0", 9)}`,
    );
  }
  push();

  push("[TIMESERIES]");
  push(";;Name           Date       Time       Value");
  const rise = Math.max(0, opts.trapRiseFrac) * endH;
  const plateau = Math.max(0, opts.trapPlateauFrac) * endH;
  const fall = Math.max(0, opts.trapFallFrac) * endH;
  const tsRows: Array<[string, number]> = [
    [fmtH(0), 0],
    [fmtH(rise), peak],
    [fmtH(rise + plateau), peak],
    [fmtH(rise + plateau + fall), 0],
  ];
  if (rise + plateau + fall < endH - 1e-6) {
    tsRows.push([fmtH(endH), 0]);
  }
  for (const [t, v] of tsRows) {
    push(`${pad(tsName, 17)}${pad(t, 11)}${v.toFixed(4)}`);
  }
  // Storm hyetograph time series
  if (hasStorm) {
    push(`;`);
    push(`; STORM hyetograph (${opts.stormType}, depth ${opts.stormDepth} ${rainUnit}, duration ${opts.stormDurationHr} h)`);
    for (const [minOff, intensity] of storm) {
      push(`${pad("STORM", 17)}${pad(fmtH(minOff / 60), 11)}${intensity.toFixed(4)}`);
    }
  }
  push();


  push("[REPORT]");
  push("INPUT      NO");
  push("CONTROLS   NO");
  push("SUBCATCHMENTS ALL");
  push("NODES ALL");
  push("LINKS ALL");
  push();

  push("[COORDINATES]");
  push(";;Node           X-Coord            Y-Coord");
  for (const n of tree.nodes) {
    const [x, y] = coords.get(n) ?? [0, 0];
    push(`${pad(n, 17)}${pad(x.toFixed(3), 19)}${y.toFixed(3)}`);
  }
  push();

  push("[VERTICES]");
  push(";;Link           X-Coord            Y-Coord");
  push();

  if (hasSubs) {
    push("[Polygons]");
    push(";;Subcatchment   X-Coord            Y-Coord");
    // small square polygon around each junction
    const sz = Math.max(0.5, 2 * opts.coordScale * 20);
    for (const n of tree.nodes) {
      if (n === 1) continue;
      const [x, y] = coords.get(n) ?? [0, 0];
      const corners: Array<[number, number]> = [
        [x - sz, y - sz], [x + sz, y - sz], [x + sz, y + sz], [x - sz, y + sz],
      ];
      for (const [px, py] of corners) {
        push(`${pad("S" + n, 17)}${pad(px.toFixed(3), 19)}${py.toFixed(3)}`);
      }
    }
    push();
  }

  const inverts = new Map<number, number>();
  for (const n of tree.nodes) inverts.set(n, invertOf(n));

  return {
    inp: lines.join("\n"),
    nodeCount: tree.nodes.size,
    conduitCount: cid,
    tree,
    coords,
    inverts,
    endTimeSec: opts.endTimeSec,
    upstreamCount,
    conduitDiameter,
    storm,
    subcatchmentCount,
  };
}
