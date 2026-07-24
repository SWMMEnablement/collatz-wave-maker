// Extract high-level metrics from a SWMM 5 .rpt file.
// Formats are stable across 5.1.x / 5.2.x — the labels below are the
// section headers EPA-SWMM prints in every run.

export interface RptSummary {
  // Continuity — percent error (positive => inflow > outflow in the mass balance)
  runoffContinuityPct: number | null;
  flowContinuityPct: number | null;
  qualityContinuityPct: number | null;

  // Node flooding summary — one row per flooded junction
  floodedNodes: FloodedNode[];
  totalFloodVolumeMgalOrMlt: number | null; // reported total

  // Node surcharge summary — one row per surcharged node
  surchargedNodes: SurchargedNode[];
  maxSurchargeHours: number | null;

  // Simulation run
  runTimeSec: number | null;
  analysisErrors: string[];
  analysisWarnings: string[];
}

export interface FloodedNode {
  id: string;
  hoursFlooded: number;
  maxRatePerSec: number;
  totalFloodVolume: number; // 10^6 gal (US) or 10^6 L (metric)
}

export interface SurchargedNode {
  id: string;
  hoursSurcharged: number;
  maxHeightAboveCrown: number;
  minDepthBelowRim: number;
}

const NUM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function parsePct(line: string): number | null {
  const m = line.match(/(-?\d+\.\d+)/);
  return m ? Number(m[1]) : null;
}

function section(rpt: string, header: RegExp): string | null {
  const m = header.exec(rpt);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Section ends at the next blank-line-then-header, or two blank lines.
  const rest = rpt.slice(start);
  const end = rest.search(/\n\s*\n\s*\*{3,}/) ;
  return end === -1 ? rest : rest.slice(0, end);
}

export function parseRptSummary(rpt: string): RptSummary {
  const out: RptSummary = {
    runoffContinuityPct: null,
    flowContinuityPct: null,
    qualityContinuityPct: null,
    floodedNodes: [],
    totalFloodVolumeMgalOrMlt: null,
    surchargedNodes: [],
    maxSurchargeHours: null,
    runTimeSec: null,
    analysisErrors: [],
    analysisWarnings: [],
  };
  if (!rpt) return out;

  // Continuity error lines look like:
  //   Continuity Error (%) . . . . . . . . . . .    -0.031
  const runoff = /Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\)[^\n]*/i.exec(rpt);
  if (runoff) out.runoffContinuityPct = parsePct(runoff[0]);
  const flow = /Flow Routing Continuity[\s\S]*?Continuity Error \(%\)[^\n]*/i.exec(rpt);
  if (flow) out.flowContinuityPct = parsePct(flow[0]);
  const qual = /Quality Routing Continuity[\s\S]*?Continuity Error \(%\)[^\n]*/i.exec(rpt);
  if (qual) out.qualityContinuityPct = parsePct(qual[0]);

  // Node Flooding Summary
  //   Node          Hours   Maximum   Time of Max   Total   Maximum
  //                Flooded    Rate    Occurrence   Flood  Ponded
  //   N123           0.25     1.23    0  01:15      0.008     0
  const floodSection = section(rpt, /\*+\s*\r?\n\s*Node Flooding Summary\s*\r?\n\s*\*+/i);
  if (floodSection) {
    let total = 0;
    for (const line of floodSection.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("---") || /^Node|^Flooded|^\s*Hours/i.test(trimmed)) continue;
      const nums = trimmed.match(NUM);
      const id = trimmed.split(/\s+/)[0];
      if (!nums || nums.length < 5 || !/^[A-Za-z0-9_.-]+$/.test(id)) continue;
      const hoursFlooded = Number(nums[0]);
      const maxRatePerSec = Number(nums[1]);
      const totalVol = Number(nums[nums.length - 2]); // total flood volume column
      if (!isFinite(hoursFlooded)) continue;
      out.floodedNodes.push({ id, hoursFlooded, maxRatePerSec, totalFloodVolume: totalVol });
      total += totalVol;
    }
    if (out.floodedNodes.length) out.totalFloodVolumeMgalOrMlt = total;
  }

  // Node Surcharge Summary
  //   Node      Hours       Max.Height Above Crown    Min.Depth Below Rim
  const surSection = section(rpt, /\*+\s*\r?\n\s*Node Surcharge Summary\s*\r?\n\s*\*+/i);
  if (surSection) {
    let maxH = 0;
    for (const line of surSection.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("---") || /^Node|^Hours|Surcharge/i.test(trimmed)) continue;
      const nums = trimmed.match(NUM);
      const id = trimmed.split(/\s+/)[0];
      if (!nums || nums.length < 3 || !/^[A-Za-z0-9_.-]+$/.test(id)) continue;
      const hoursSurcharged = Number(nums[0]);
      const maxHeightAboveCrown = Number(nums[1]);
      const minDepthBelowRim = Number(nums[2]);
      if (!isFinite(hoursSurcharged)) continue;
      out.surchargedNodes.push({ id, hoursSurcharged, maxHeightAboveCrown, minDepthBelowRim });
      if (hoursSurcharged > maxH) maxH = hoursSurcharged;
    }
    if (out.surchargedNodes.length) out.maxSurchargeHours = maxH;
  }

  // Analysis errors are printed as lines starting with "ERROR" or "WARNING"
  for (const line of rpt.split(/\r?\n/)) {
    if (/^\s*ERROR\b/i.test(line)) out.analysisErrors.push(line.trim());
  }

  const rt = /Total elapsed time[^\n]*?(\d+:\d\d:\d\d(?:\.\d+)?)/i.exec(rpt);
  if (rt) {
    const [h, m, s] = rt[1].split(":").map(Number);
    out.runTimeSec = h * 3600 + m * 60 + s;
  }

  return out;
}
