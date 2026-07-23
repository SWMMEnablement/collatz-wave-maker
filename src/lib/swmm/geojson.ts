import type { BuildResult } from "./inp";

interface GeoJsonFeature {
  type: "Feature";
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: [number, number][] };
  properties: Record<string, unknown>;
}

interface GeoJsonFC {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/**
 * Emit a GeoJSON FeatureCollection with node Points and conduit LineStrings.
 * Coordinates are the already-scaled planar coords used in the .inp file — they
 * are not lat/lon, so most GIS tools will need a local/projected CRS assumption.
 */
export function buildGeoJson(built: BuildResult): GeoJsonFC {
  const features: GeoJsonFeature[] = [];
  for (const n of built.tree.nodes) {
    const p = built.coords.get(n);
    if (!p) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p[0], p[1]] },
      properties: {
        id: n,
        kind: n === 1 ? "outfall" : "junction",
        depth: built.tree.depth.get(n) ?? 0,
        invert: built.inverts.get(n) ?? 0,
        upstreamCount: built.upstreamCount.get(n) ?? 1,
      },
    });
  }
  let cid = 0;
  for (const [from, to] of built.tree.edges) {
    cid++;
    const a = built.coords.get(from);
    const b = built.coords.get(to);
    if (!a || !b) continue;
    const id = "C" + cid;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[a[0], a[1]], [b[0], b[1]]] },
      properties: {
        id,
        from,
        to,
        diameter: built.conduitDiameter.get(id) ?? null,
        step: from % 2 === 0 ? "n/2" : "3n+1",
      },
    });
  }
  return { type: "FeatureCollection", features };
}
