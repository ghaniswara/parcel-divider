/**
 * @module hit
 * Hit-testing and snapping: which vertex/edge/label/background-handle is
 * under the cursor, and where a dragged point is allowed to land.
 *
 * All functions read the shared state ({@link module:state}) and use the
 * world↔screen transforms from {@link module:transform}.
 */

import { S } from "./state.js";
import { w2s, s2w } from "./transform.js";
import { closestPointOnSeg, pipPoly } from "./math.js";

/**
 * Find the closest point on the outer boundary ring to a world point.
 *
 * @param {number} wx
 * @param {number} wy
 * @returns {Pt} Closest boundary point (the query point itself when no
 *   outer polygon exists).
 */
export function constrainToBoundary(wx, wy) {
  if (!S.outerGeo || S.outerGeo.length < 3) return { x: wx, y: wy };
  let best = null,
    minDist = Infinity;
  for (let i = 0; i < S.outerGeo.length; i++) {
    const a = S.outerGeo[i],
      b = S.outerGeo[(i + 1) % S.outerGeo.length];
    const cp = closestPointOnSeg({ x: wx, y: wy }, a, b);
    const d = Math.hypot(wx - cp.x, wy - cp.y);
    if (d < minDist) {
      minDist = d;
      best = cp;
    }
  }
  return best;
}

/**
 * Compare two vertex references for identity (same kind + index).
 *
 * @param {VtxRef|null} v1
 * @param {VtxRef|null} v2
 * @returns {boolean}
 */
export function sameVtx(v1, v2) {
  if (!v1 && !v2) return true;
  if (!v1 || !v2) return false;
  return v1.type === v2.type && v1.id === v2.id;
}

/**
 * Find the nearest vertex or edge point to a world position, excluding
 * vertices/edges touching `ignoreVtx` (the dragged vertex itself).
 *
 * @param {number} wx
 * @param {number} wy
 * @param {VtxRef|null} [ignoreVtx]
 * @returns {{pt: Pt|null, dist: number}} Nearest snap point and its world distance.
 */
export function getSnapPoint(wx, wy, ignoreVtx = null) {
  let best = null,
    minDist = Infinity;

  if (S.topo) {
    S.topo.vertices.forEach((v, i) => {
      if (ignoreVtx && ignoreVtx.type === "topo" && ignoreVtx.id === i)
        return;
      const d = Math.hypot(wx - v.x, wy - v.y);
      if (d > 1e-4 && d < minDist) {
        minDist = d;
        best = { x: v.x, y: v.y };
      }
    });
  }
  if (S.outerGeo) {
    S.outerGeo.forEach((v, i) => {
      if (ignoreVtx && ignoreVtx.type === "outer" && ignoreVtx.id === i)
        return;
      const d = Math.hypot(wx - v.x, wy - v.y);
      if (d > 1e-4 && d < minDist) {
        minDist = d;
        best = { x: v.x, y: v.y };
      }
    });
  }

  if (S.outerGeo) {
    for (let i = 0; i < S.outerGeo.length; i++) {
      if (
        ignoreVtx &&
        ignoreVtx.type === "outer" &&
        (ignoreVtx.id === i ||
          ignoreVtx.id === (i + 1) % S.outerGeo.length)
      )
        continue;
      const a = S.outerGeo[i],
        b = S.outerGeo[(i + 1) % S.outerGeo.length];
      const cp = closestPointOnSeg({ x: wx, y: wy }, a, b);
      const d = Math.hypot(wx - cp.x, wy - cp.y);
      if (d > 1e-4 && d < minDist) {
        minDist = d;
        best = cp;
      }
    }
  }
  if (S.topo) {
    S.topo.parcels.forEach((p) => {
      for (let i = 0; i < p.vids.length; i++) {
        const v1 = p.vids[i],
          v2 = p.vids[(i + 1) % p.vids.length];
        if (
          ignoreVtx &&
          ignoreVtx.type === "topo" &&
          (ignoreVtx.id === v1 || ignoreVtx.id === v2)
        )
          continue;
        const a = S.topo.vertices[v1],
          b = S.topo.vertices[v2];
        const cp = closestPointOnSeg({ x: wx, y: wy }, a, b);
        const d = Math.hypot(wx - cp.x, wy - cp.y);
        if (d > 1e-4 && d < minDist) {
          minDist = d;
          best = cp;
        }
      }
    });
  }
  return { pt: best, dist: minDist };
}

/**
 * Constrain a dragged point inside the outer polygon and snap it to
 * nearby vertices/edges. Snapping is bypassed while Shift/Alt/Ctrl/Meta
 * is held. Vertices belonging to the outer polygon are not constrained
 * inside (they *are* the boundary) — they only snap.
 *
 * @param {number} wx
 * @param {number} wy
 * @param {MouseEvent|null} e - Pointer event used to detect snap-bypass keys.
 * @param {VtxRef|null} [ignoreVtx] - Vertex being dragged (its own edges are ignored).
 * @returns {Pt} The constrained/snapped position.
 */
export function enforceInsideAndSnap(wx, wy, e, ignoreVtx = null) {
  if (ignoreVtx && ignoreVtx.type === "outer") {
    const disableSnap =
      e && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);
    if (!disableSnap) {
      const snap = getSnapPoint(wx, wy, ignoreVtx);
      if (snap.pt && snap.dist < 16 / S.zoom) return snap.pt;
    }
    return { x: wx, y: wy };
  }

  let isInside = true,
    cp = null;
  if (S.outerGeo && S.outerGeo.length >= 3) {
    isInside = pipPoly(wx, wy, S.outerGeo);
    cp = constrainToBoundary(wx, wy);
  }

  let target = { x: wx, y: wy };
  if (!isInside && cp) {
    target = cp;
  }

  const disableSnap =
    e && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);
  if (!disableSnap) {
    const snap = getSnapPoint(target.x, target.y, ignoreVtx);
    // Snap radius gets slightly larger if constrained to boundary to help catch vertices
    if (snap.pt && snap.dist < 16 / S.zoom) return snap.pt;
  }

  return target;
}

/**
 * Find the vertex under screen coordinates, depending on the active tool
 * (`select` → topology vertices, `edit-outer` → outer ring vertices).
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {VtxRef|null}
 */
export function hitVtx(sx, sy) {
  const [wx, wy] = s2w(sx, sy);
  let best = null,
    bestD = Infinity;

  if (S.tool === "select" && S.topo) {
    S.topo.vertices.forEach((v, i) => {
      const [vsx, vsy] = w2s(v.x, v.y);
      const d = Math.hypot(sx - vsx, sy - vsy);
      if (d < 14 && d < bestD) {
        bestD = d;
        best = { type: "topo", id: i };
      }
    });
  } else if (S.tool === "edit-outer" && S.outerGeo) {
    S.outerGeo.forEach((v, i) => {
      const [vsx, vsy] = w2s(v.x, v.y);
      const d = Math.hypot(sx - vsx, sy - vsy);
      if (d < 14 && d < bestD) {
        bestD = d;
        best = { type: "outer", id: i };
      }
    });
  }
  return best;
}

/**
 * Find the edge under screen coordinates. Topology edges are tested in
 * `select`/`calibrate` tools; outer edges only when nothing closer
 * matched and the tool is `edit-outer`/`calibrate`.
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {EdgeRef|null}
 */
export function hitEdge(sx, sy) {
  const [wx, wy] = s2w(sx, sy);
  let best = null,
    bestD = Infinity;

  if ((S.tool === "select" || S.tool === "calibrate") && S.topo) {
    S.topo.parcels.forEach((p) => {
      for (let i = 0; i < p.vids.length; i++) {
        const v1 = p.vids[i],
          v2 = p.vids[(i + 1) % p.vids.length];
        const A = S.topo.vertices[v1],
          B = S.topo.vertices[v2];
        const [Asx, Asy] = w2s(A.x, A.y);
        const [Bsx, Bsy] = w2s(B.x, B.y);
        const cp = closestPointOnSeg(
          { x: sx, y: sy },
          { x: Asx, y: Asy },
          { x: Bsx, y: Bsy },
        );
        const d = Math.hypot(sx - cp.x, sy - cp.y);
        if (d < 8 && d < bestD) {
          bestD = d;
          best = { type: "topo", v1, v2 };
        }
      }
    });
  }

  if (!best && (S.tool === "edit-outer" || S.tool === "calibrate") && S.outerGeo) {
    for (let i = 0; i < S.outerGeo.length; i++) {
      const a = S.outerGeo[i],
        b = S.outerGeo[(i + 1) % S.outerGeo.length];
      const [Asx, Asy] = w2s(a.x, a.y);
      const [Bsx, Bsy] = w2s(b.x, b.y);
      const cp = closestPointOnSeg(
        { x: sx, y: sy },
        { x: Asx, y: Asy },
        { x: Bsx, y: Bsy },
      );
      const d = Math.hypot(sx - cp.x, sy - cp.y);
      if (d < 8 && d < bestD) {
        bestD = d;
        best = { type: "outer", i1: i, i2: (i + 1) % S.outerGeo.length };
      }
    }
  }
  return best;
}

/**
 * Hit-test the background image handles (corners, edges, body) while in
 * `edit-bg` tool. Handles are tested in the image's local (rotated) frame.
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {{type: 'bg-corner'|'bg-edge'|'bg-body', id?: string}|null}
 */
export function hitBg(sx, sy) {
  if (S.tool !== "edit-bg" || !S.bgImage) return null;
  const [wx, wy] = s2w(sx, sy);
  const sw = S.bgImage.width * S.bg.scale;
  const sh = S.bgImage.height * S.bg.scale;
  const hw = sw / 2,
    hh = sh / 2;

  const dx = wx - S.bg.x,
    dy = wy - S.bg.y;
  const angle = (-S.bg.rot * Math.PI) / 180;
  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);

  const r = 16 / S.zoom;
  const corners = [
    { id: "tl", x: -hw, y: -hh },
    { id: "tr", x: hw, y: -hh },
    { id: "bl", x: -hw, y: hh },
    { id: "br", x: hw, y: hh },
  ];
  for (let c of corners) {
    if (Math.hypot(rx - c.x, ry - c.y) < r)
      return { type: "bg-corner", id: c.id };
  }

  if (Math.abs(ry - (-hh)) < r && rx > -hw && rx < hw) return { type: "bg-edge", id: "t" };
  if (Math.abs(ry - hh) < r && rx > -hw && rx < hw) return { type: "bg-edge", id: "b" };
  if (Math.abs(rx - (-hw)) < r && ry > -hh && ry < hh) return { type: "bg-edge", id: "l" };
  if (Math.abs(rx - hw) < r && ry > -hh && ry < hh) return { type: "bg-edge", id: "r" };

  if (rx >= -hw && rx <= hw && ry >= -hh && ry <= hh)
    return { type: "bg-body" };
  return null;
}

/**
 * Point-in-parcel test for a topology parcel (ray casting on its ring).
 *
 * @param {number} wx
 * @param {number} wy
 * @param {Parcel} p
 * @returns {boolean}
 */
export function pip(wx, wy, p) {
  const ring = p.vids.map((i) => S.topo.vertices[i]);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const { x: xi, y: yi } = ring[i],
      { x: xj, y: yj } = ring[j];
    if (
      yi > wy !== yj > wy &&
      wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
