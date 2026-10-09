/**
 * @module math
 * Pure geometry helpers: segment projection, point-in-polygon, line
 * intersection, polygon area and Sutherland–Hodgman half-plane clipping
 * (used by the strip splitter).
 *
 * All functions are side-effect free and take plain `{x, y}` points.
 */

/**
 * Project `p` onto segment `a`–`b`, clamped to the segment.
 *
 * @param {Pt} p - Query point.
 * @param {Pt} a - Segment start.
 * @param {Pt} b - Segment end.
 * @returns {{x: number, y: number, t: number}} Closest point plus parametric position `t` (0..1).
 */
export function closestPointOnSeg(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { x: a.x, y: a.y, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy, t: t };
}

/**
 * Ray-casting point-in-polygon test against a point array.
 *
 * @param {number} wx
 * @param {number} wy
 * @param {Pt[]} poly - Polygon ring (first != last, closed implicitly).
 * @returns {boolean} True if the point is inside.
 */
export function pipPoly(wx, wy, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { x: xi, y: yi } = poly[i],
      { x: xj, y: yj } = poly[j];
    if (
      yi > wy !== yj > wy &&
      wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Intersection point of the infinite lines through `p1`–`p2` and `p3`–`p4`.
 *
 * @param {Pt} p1
 * @param {Pt} p2
 * @param {Pt} p3
 * @param {Pt} p4
 * @returns {Pt|null} Intersection point, or null when (near-)parallel.
 */
export function lineIntersection(p1, p2, p3, p4) {
  const d1x = p1.x - p2.x,
    d1y = p1.y - p2.y;
  const d2x = p3.x - p4.x,
    d2y = p3.y - p4.y;
  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-9) return null;
  const c1 = p1.x * p2.y - p1.y * p2.x;
  const c2 = p3.x * p4.y - p3.y * p4.x;
  return {
    x: (c1 * d2x - c2 * d1x) / det,
    y: (c1 * d2y - c2 * d1y) / det,
  };
}

/**
 * Shoelace area of a point ring (orientation-independent).
 *
 * @param {Pt[]} pts - Polygon ring (first != last).
 * @returns {number} Unsigned area in world units².
 */
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

/**
 * Sutherland–Hodgman clip of `poly` against the half-plane
 * `a*x + b*y <= c`.
 *
 * @param {Pt[]} poly
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {Pt[]} Clipped polygon (possibly empty).
 */
export function clipHP(poly, a, b, c) {
  if (!poly.length) return [];
  const out = [];
  const ins = (v) => a * v.x + b * v.y <= c + 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i],
      next = poly[(i + 1) % poly.length];
    const ci = ins(curr),
      cn = ins(next);
    if (ci) out.push(curr);
    if (ci !== cn) {
      const dc = a * curr.x + b * curr.y - c,
        dn = a * next.x + b * next.y - c;
      const t = dc / (dc - dn);
      out.push({
        x: curr.x + t * (next.x - curr.x),
        y: curr.y + t * (next.y - curr.y),
      });
    }
  }
  return out;
}

/**
 * Split a polygon into `n` horizontal strips.
 *
 * @param {Pt[]} poly
 * @param {number} n - Number of strips (>= 1).
 * @returns {Pt[][]} Strip polygons.
 */
export function splitPolyH(poly, n) {
  const ys = poly.map((v) => v.y);
  const yMin = Math.min(...ys),
    yMax = Math.max(...ys);
  const step = (yMax - yMin) / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const yLo = yMin + i * step,
      yHi = i === n - 1 ? yMax + 1e-9 : yMin + (i + 1) * step;
    let p = clipHP(poly, 0, 1, yHi);
    p = clipHP(p, 0, -1, -yLo);
    if (p.length >= 3) parts.push(p);
  }
  return parts;
}

/**
 * Split a polygon into `n` vertical strips.
 *
 * @param {Pt[]} poly
 * @param {number} n - Number of strips (>= 1).
 * @returns {Pt[][]} Strip polygons.
 */
export function splitPolyV(poly, n) {
  const xs = poly.map((v) => v.x);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const step = (xMax - xMin) / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const xLo = xMin + i * step,
      xHi = i === n - 1 ? xMax + 1e-9 : xMin + (i + 1) * step;
    let p = clipHP(poly, 1, 0, xHi);
    p = clipHP(p, -1, 0, -xLo);
    if (p.length >= 3) parts.push(p);
  }
  return parts;
}

/**
 * Split into `n` strips along the polygon's longest bounding-box axis.
 *
 * @param {Pt[]} poly
 * @param {number} n
 * @returns {Pt[][]} Strip polygons.
 */
export function splitPolyAuto(poly, n) {
  const xs = poly.map((v) => v.x),
    ys = poly.map((v) => v.y);
  const W = Math.max(...xs) - Math.min(...xs);
  const H = Math.max(...ys) - Math.min(...ys);
  return W >= H ? splitPolyV(poly, n) : splitPolyH(poly, n);
}
