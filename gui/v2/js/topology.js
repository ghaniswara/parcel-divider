/**
 * @module topology
 * Client-side topology construction and area/target computations.
 *
 * A {@link Topo} is a de-duplicated vertex list plus parcel rings that
 * reference vertices by index, and the outer boundary ring. Building it
 * from GeoJSON-style geometry lets the editor treat outer boundary and
 * parcels uniformly (dragging, joining, locking, …).
 */

import { S, COLORS } from "./state.js";

/**
 * Build a {@link Topo} from either
 * `{outer: {type:"Polygon", coordinates:[ring]}, parcels: [Polygon, ...]}`
 * or a GeoJSON FeatureCollection with `properties.role` of `"outer"` /
 * `"parcel"`.
 *
 * Vertices are de-duplicated by rounding coordinates to 1e-7 precision.
 *
 * @param {Object} geo - GeoJSON-ish input geometry.
 * @returns {Topo} Topology with `vertices`, `parcels`, `outer`.
 */
export function buildTopo(geo) {
  const PREC = 1e7;
  const vmap = new Map();
  const vertices = [];
  const parcels = [];
  let outer = [];

  /**
   * Intern a coordinate pair, returning a stable vertex id.
   *
   * @param {number} x
   * @param {number} y
   * @returns {number} Vertex index.
   */
  function vid(x, y) {
    const k = `${Math.round(x * PREC) / PREC},${Math.round(y * PREC) / PREC}`;
    if (!vmap.has(k)) {
      vmap.set(k, vertices.length);
      vertices.push({ x, y });
    }
    return vmap.get(k);
  }

  let rings = [];
  if (geo.type === "FeatureCollection") {
    const of = geo.features.find((f) => f.properties?.role === "outer");
    if (of)
      outer = of.geometry.coordinates[0]
        .slice(0, -1)
        .map(([x, y]) => ({ x, y }));
    rings = geo.features
      .filter((f) => f.properties?.role !== "outer")
      .map((f) => f.geometry.coordinates[0]);
  } else {
    outer = geo.outer.coordinates[0]
      .slice(0, -1)
      .map(([x, y]) => ({ x, y }));
    rings = geo.parcels.map((p) => p.coordinates[0]);
  }

  rings.forEach((ring, i) => {
    const pts = ring.slice(0, -1);
    const vids = pts.map(([x, y]) => vid(x, y));
    parcels.push({
      vids,
      color: COLORS[i % COLORS.length],
      label: `Lot ${i}`,
    });
  });

  return { vertices, parcels, outer };
}

/**
 * Shoelace area of a parcel polygon, in world units².
 *
 * @param {Parcel} p
 * @returns {number}
 */
export function pArea(p) {
  const n = p.vids.length;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const A = S.topo.vertices[p.vids[j]],
      B = S.topo.vertices[p.vids[i]];
    a += (A.x + B.x) * (A.y - B.y);
  }
  return Math.abs(a / 2);
}

/**
 * Sum of all parcel areas (world units²). 0 when no topology is loaded.
 *
 * @returns {number}
 */
export function totalArea() {
  if (!S.topo) return 0;
  return S.topo.parcels.reduce((s, p) => s + pArea(p), 0);
}

/**
 * Absolute target area per parcel (world units²), keyed by parcel index —
 * only when at least one custom target share is set. Otherwise null
 * (the API then treats all parcels equally).
 *
 * @returns {Object<number, number>|null}
 */
export function getTargetAreas() {
  if (!S.topo) return null;
  const hasCustom = Object.keys(S.targetPcts).some(
    (k) => S.targetPcts[k] != null && !isNaN(S.targetPcts[k]) && S.targetPcts[k] > 0,
  );
  if (!hasCustom) return null;
  const ta = {};
  for (let i = 0; i < S.topo.parcels.length; i++) ta[i] = targetArea(i);
  return ta;
}

/**
 * Effective target area for one parcel: its custom share of the total
 * area when set, otherwise an equal share of the remainder.
 *
 * @param {number} i - Parcel index.
 * @returns {number} Target area in world units².
 */
export function targetArea(i) {
  if (!S.topo) return 0;
  const tot = totalArea();
  const n = S.topo.parcels.length;
  const v = S.targetPcts[i];
  if (v != null && !isNaN(v) && v > 0) return (v / 100) * tot;
  return tot / n;
}

/**
 * Find the neighbor vertex of `vid` along some parcel ring, skipping
 * `excludeVid`. Used by parallel-constraint logic to find the line a
 * joined/moved vertex is constrained to.
 *
 * @param {number} vid - Vertex to look up.
 * @param {number} excludeVid - Neighbor to exclude.
 * @returns {number|null} Adjacent vertex id, or null when none/topology missing.
 */
export function getAdjVertex(vid, excludeVid) {
  if (!S.topo) return null;
  let best = null;
  S.topo.parcels.forEach((p) => {
    const n = p.vids.length;
    for (let i = 0; i < n; i++) {
      if (p.vids[i] === vid) {
        const p1 = p.vids[(i + n - 1) % n];
        const p2 = p.vids[(i + 1) % n];
        if (p1 !== excludeVid) best = p1;
        else if (p2 !== excludeVid) best = p2;
      }
    }
  });
  return best;
}
