// SWMM5 binary .out file parser.
// Spec: see EPA SWMM5 source output.c.
//
// Per-object variable counts (v5.2, no pollutants):
//   subcatch: 9 + Npoll
//   node:     6 + Npoll  (depth, head, volume, lateralInflow, totalInflow, overflow)
//   link:     5 + Npoll  (flow, depth, velocity, volume, capacity)
//   system:   15

export interface ParsedOut {
  flowUnits: number;
  startDate: number;
  reportStep: number;
  nPeriods: number;
  errorCode: number;
  nodeIds: string[];
  linkIds: string[];
  times: number[];
  nodeDepth: Float32Array[];
  nodeTotalInflow: Float32Array[];
  linkFlow: Float32Array[];
  sysVars: Float32Array[]; // length 15, each of length nPeriods
}

const MAGIC = 516114522;

const i32 = (dv: DataView, o: number) => dv.getInt32(o, true);
const f32 = (dv: DataView, o: number) => dv.getFloat32(o, true);
const f64 = (dv: DataView, o: number) => dv.getFloat64(o, true);

export function parseSwmmOut(buf: Uint8Array): ParsedOut | null {
  if (buf.byteLength < 32) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.byteLength;

  if (i32(dv, end - 4) !== MAGIC) return null;
  const errorCode = i32(dv, end - 8);
  const nPeriods = i32(dv, end - 12);
  const resultsOffset = i32(dv, end - 16);
  // const objPropOffset = i32(dv, end - 20);
  const objIdOffset = i32(dv, end - 24);

  if (i32(dv, 0) !== MAGIC) return null;
  const flowUnits = i32(dv, 8);
  const Nsub = i32(dv, 12);
  const Nnode = i32(dv, 16);
  const Nlink = i32(dv, 20);
  const Npoll = i32(dv, 24);

  // --- Read object IDs (length-prefixed ASCII) ---
  let off = objIdOffset;
  const decoder = new TextDecoder("utf-8");
  const readId = (): string => {
    const len = i32(dv, off);
    off += 4;
    const s = decoder.decode(buf.subarray(off, off + len));
    off += len;
    return s;
  };
  const subIds: string[] = [];
  for (let i = 0; i < Nsub; i++) subIds.push(readId());
  const nodeIds: string[] = [];
  for (let i = 0; i < Nnode; i++) nodeIds.push(readId());
  const linkIds: string[] = [];
  for (let i = 0; i < Nlink; i++) linkIds.push(readId());
  for (let i = 0; i < Npoll; i++) readId();

  // --- ReportStep + StartDate live just before resultsOffset ---
  // Layout: ... StartDate(f64) ReportStep(i32) | results...
  const startDate = f64(dv, resultsOffset - 12);
  const reportStep = i32(dv, resultsOffset - 4);

  const nSubVars = 9 + Npoll;
  const nNodeVars = 6 + Npoll;
  const nLinkVars = 5 + Npoll;
  const nSysVars = 15;

  // bytes per reporting period: f64 dateTime + all f32 vars
  const perPeriod =
    8 +
    4 * (Nsub * nSubVars + Nnode * nNodeVars + Nlink * nLinkVars + nSysVars);

  const times: number[] = new Array(nPeriods);
  const nodeDepth: Float32Array[] = Array.from(
    { length: Nnode },
    () => new Float32Array(nPeriods),
  );
  const nodeTotalInflow: Float32Array[] = Array.from(
    { length: Nnode },
    () => new Float32Array(nPeriods),
  );
  const linkFlow: Float32Array[] = Array.from(
    { length: Nlink },
    () => new Float32Array(nPeriods),
  );
  const sysVars: Float32Array[] = Array.from(
    { length: nSysVars },
    () => new Float32Array(nPeriods),
  );

  for (let p = 0; p < nPeriods; p++) {
    const base = resultsOffset + p * perPeriod;
    if (base + perPeriod > end) break;
    times[p] = (p * reportStep) / 60; // minutes
    // skip dateTime f64 + subcatch block
    const nodesBase = base + 8 + 4 * Nsub * nSubVars;
    for (let n = 0; n < Nnode; n++) {
      const nb = nodesBase + n * nNodeVars * 4;
      nodeDepth[n][p] = f32(dv, nb); // var 0 = depth
      nodeTotalInflow[n][p] = f32(dv, nb + 16); // var 4 = totalInflow
    }
    const linksBase = nodesBase + 4 * Nnode * nNodeVars;
    for (let l = 0; l < Nlink; l++) {
      const lb = linksBase + l * nLinkVars * 4;
      linkFlow[l][p] = f32(dv, lb); // var 0 = flow
    }
    const sysBase = linksBase + 4 * Nlink * nLinkVars;
    for (let s = 0; s < nSysVars; s++) {
      sysVars[s][p] = f32(dv, sysBase + s * 4);
    }
  }

  return {
    flowUnits,
    startDate,
    reportStep,
    nPeriods,
    errorCode,
    nodeIds,
    linkIds,
    times,
    nodeDepth,
    nodeTotalInflow,
    linkFlow,
  };
}
