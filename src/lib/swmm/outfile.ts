// SWMM5 binary .out file parser.
// Spec: see EPA SWMM5 source output.c. Layout summary:
//   [opening records] magic(i32) version(i32) flowUnits(i32)
//       Nsubcatch(i32) Nnode(i32) Nlink(i32) Npollut(i32)
//   [object IDs]      for each subcatch/node/link/pollut: len(i32)+chars
//   [object properties], [reporting variables]
//   StartDate (f64), ReportStep (i32)
//   [computed results] per period: dateTime(f64) +
//       Nsubcatch * NsubVars(f32) + Nnode * NnodeVars(f32) +
//       Nlink * NlinkVars(f32) + NsysVars(f32)
//   [closing records] objIDOffset(i32) objPropOffset(i32)
//       resultsOffset(i32) Nperiods(i32) errorCode(i32) magic(i32)
//
// Per-object variable counts in v5.2 (no pollutants in our INPs):
//   subcatch: 9 + Npoll
//   node:     6 + Npoll  (depth, head, volume, lateralInflow, totalInflow, overflow)
//   link:     5 + Npoll  (flow, depth, velocity, volume, capacity)
//   system:   15

export interface ParsedOut {
  flowUnits: number;
  startDate: number; // SWMM Julian (days since 1899-12-30)
  reportStep: number; // seconds
  nPeriods: number;
  errorCode: number;
  nodeIds: string[];
  linkIds: string[];
  times: number[]; // minutes from start
  // by node index: arrays of length nPeriods
  nodeDepth: Float32Array[];
  nodeTotalInflow: Float32Array[];
}

const MAGIC = 516114522;

function readI32(dv: DataView, off: number): number {
  return dv.getInt32(off, true);
}
function readF64(dv: DataView, off: number): number {
  return dv.getFloat64(off, true);
}
function readF32(dv: DataView, off: number): number {
  return dv.getFloat32(off, true);
}

export function parseSwmmOut(buf: Uint8Array): ParsedOut | null {
  if (buf.byteLength < 32) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.byteLength;

  // Closing records (last 24 bytes): 6 Int32s.
  const magicTail = readI32(dv, end - 4);
  if (magicTail !== MAGIC) return null;
  const errorCode = readI32(dv, end - 8);
  const nPeriods = readI32(dv, end - 12);
  const resultsOffset = readI32(dv, end - 16);
  // const objPropOffset = readI32(dv, end - 20);
  const objIdOffset = readI32(dv, end - 24);

  // Opening header.
  const magicHead = readI32(dv, 0);
  if (magicHead !== MAGIC) return null;
  // version at 4, flow units at 8
  const flowUnits = readI32(dv, 8);
  const Nsub = readI32(dv, 12);
  const Nnode = readI32(dv, 16);
  const Nlink = readI32(dv, 20);
  const Npoll = readI32(dv, 24);

  // Object IDs section starts at objIdOffset.
  // Order: subcatch IDs, node IDs, link IDs, pollutant IDs.
  let