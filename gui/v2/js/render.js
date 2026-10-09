/**
 * @module render
 * All canvas painting for the editor: grid, background image, outer
 * boundary, topology parcels, in-progress drawing, locked edges,
 * selection handles and measurement labels.
 *
 * Mirrors v1's structure:
 * - {@link drawCore} is the pure repaint (v1's inner `draw`),
 * - {@link draw} is the repaint + parcel-list refresh notification
 *   (v1's `window.draw` wrapper) — most call sites use this one.
 *
 * After a repaint, `selection` is emitted (v1 called `updateVtxTools()`
 * from draw); {@link draw} additionally emits `parcels` when geometry
 * exists (v1's wrapper called `updatePcList()`).
 */

import { S } from "./state.js";
import { w2s, s2w } from "./transform.js";
import { pArea, targetArea } from "./topology.js";
import { emit } from "./events.js";

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

/**
 * Bind the renderer to a canvas element. Called once by `<pee-canvas>`.
 *
 * @param {HTMLCanvasElement} cv
 * @returns {void}
 */
export function init(cv) {
  canvas = cv;
  ctx = cv.getContext("2d");
}

/**
 * The canvas element the renderer is bound to.
 *
 * @returns {HTMLCanvasElement|null}
 */
export function getCanvas() {
  return canvas;
}

/**
 * Pure repaint of the whole scene (v1's inner `draw`). Emits `selection`
 * afterwards so toolbar buttons stay in sync.
 *
 * @returns {void}
 */
export function drawCore() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBg();
  drawGrid();
  if (S.outerGeo) drawOuterBoundary();
  if (S.topo) drawTopo();
  drawInProgress();
  if (S.topo) drawLockedEdges();
  if (S.outerGeo || S.topo) drawHandles();
  emit("selection");
}

/**
 * Repaint + parcel-list refresh (v1's global `draw` wrapper). Use this
 * everywhere except where v1 explicitly called the unwrapped draw
 * (`setTargetPct`).
 *
 * @returns {void}
 */
export function draw() {
  drawCore();
  if (S.topo || S.outerGeo) emit("parcels");
}

/**
 * Paint the background image (if loaded) with its opacity/rotation/
 * scale, plus the dashed edit frame while in `edit-bg` tool.
 *
 * @returns {void}
 */
export function drawBg() {
  if (!S.bgImage) return;
  ctx.save();
  ctx.globalAlpha = S.bg.opacity;
  const [sx, sy] = w2s(S.bg.x, S.bg.y);
  ctx.translate(sx, sy);
  ctx.rotate((S.bg.rot * Math.PI) / 180);
  const sw = S.bgImage.width * S.bg.scale * S.zoom;
  const sh = S.bgImage.height * S.bg.scale * S.zoom;
  ctx.drawImage(S.bgImage, -sw / 2, -sh / 2, sw, sh);

  if (S.tool === "edit-bg") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Paint the adaptive world-space grid.
 *
 * @returns {void}
 */
export function drawGrid() {
  const step = gridStep();
  const [wx0, wy0] = s2w(0, canvas.height);
  const [wx1, wy1] = s2w(canvas.width, 0);
  ctx.save();
  ctx.globalAlpha = S.gridOpacity !== undefined ? S.gridOpacity : 1.0;
  ctx.strokeStyle = "#161d27";
  ctx.lineWidth = 1;
  for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
    const [sx] = w2s(x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
    ctx.stroke();
  }
  for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
    const [, sy] = w2s(0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Choose a "nice" grid step (1/2/5 × 10^n world units) for the current
 * zoom level.
 *
 * @returns {number}
 */
export function gridStep() {
  const r = 55 / S.zoom;
  const e = Math.pow(10, Math.floor(Math.log10(r)));
  for (const m of [1, 2, 5, 10]) if (m * e >= r) return m * e;
  return 10 * e;
}

/**
 * Paint the outer boundary polygon (dashed purple, solid yellow while
 * editing) with optional edge-length and corner-angle labels.
 *
 * @returns {void}
 */
export function drawOuterBoundary() {
  const pts = S.outerGeo;
  if (!pts || pts.length < 3) return;
  ctx.save();
  ctx.beginPath();
  const [fx, fy] = w2s(pts[0].x, pts[0].y);
  ctx.moveTo(fx, fy);
  for (let i = 1; i < pts.length; i++) {
    const [sx, sy] = w2s(pts[i].x, pts[i].y);
    ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  if (!S.topo) {
    ctx.fillStyle = "#a371f710";
    ctx.fill();
  }

  if (S.tool === "edit-outer") {
    ctx.strokeStyle = "#d29922";
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#a371f7";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (S.showOuterLen || S.showOuterAng) {
    ctx.font = `500 ${Math.max(9, S.zoom * 0.4)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nV = pts.length;

    let signedArea = 0;
    for (let k = 0, j = nV - 1; k < nV; j = k++) {
      const A = pts[j],
        B = pts[k];
      signedArea += A.x * B.y - B.x * A.y;
    }

    let cx = 0,
      cy = 0;
    pts.forEach((pt) => {
      cx += pt.x;
      cy += pt.y;
    });
    cx /= nV;
    cy /= nV;

    for (let k = 0; k < nV; k++) {
      const vA = pts[k];
      const vB = pts[(k + 1) % nV];
      const vC = pts[(k + 2) % nV];

      const dx = vB.x - vA.x,
        dy = vB.y - vA.y;
      const len = Math.hypot(dx, dy);
      const mx = vA.x + dx / 2,
        my = vA.y + dy / 2;
      const [smx, smy] = w2s(mx, my);

      let nx = -dy, ny = dx;
      if (signedArea < 0) { nx = dy; ny = -dx; }
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen; ny /= nlen;
      const tx = smx - nx * 18;
      const ty = smy + ny * 18;

      const txtLen = `${(len * S.measScale).toFixed(2)}m`;
      const wLen = ctx.measureText(txtLen).width;

      if (S.showOuterLen) {
        ctx.fillStyle = "#0d1117cc";
        ctx.fillRect(tx - wLen / 2 - 3, ty - 7, wLen + 6, 14);
        ctx.fillStyle = "#a371f7";
        ctx.fillText(txtLen, tx, ty);
      }

      const baX = vA.x - vB.x,
        baY = vA.y - vB.y;
      const bcX = vC.x - vB.x,
        bcY = vC.y - vB.y;
      const dot = baX * bcX + baY * bcY;
      const cross = baX * bcY - baY * bcX;
      let angle = (Math.atan2(cross, dot) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      if (signedArea < 0) angle = 360 - angle;

      const [sbx, sby] = w2s(vB.x, vB.y);
      const vx = cx - vB.x,
        vy = cy - vB.y;
      const vlen = Math.hypot(vx, vy) || 1;
      const ox = sbx + (vx / vlen) * 22;
      const oy = sby - (vy / vlen) * 22;

      const txtAng = `${Math.round(angle)}°`;
      const wAng = ctx.measureText(txtAng).width;
      if (S.showOuterAng) {
        ctx.fillStyle = "#0d1117cc";
        ctx.fillRect(ox - wAng / 2 - 3, oy - 7, wAng + 6, 14);
        ctx.fillStyle = "#d29922";
        ctx.fillText(txtAng, ox, oy);
      }
    }
  }
  ctx.restore();
}

/**
 * Paint the in-progress polygon being drawn (fill preview, edges,
 * rubber-band line to cursor, vertex dots with green "close here" ring).
 *
 * @returns {void}
 */
export function drawInProgress() {
  const pts = S.drawPts;
  if (!pts.length) return;
  ctx.save();

  if (pts.length >= 3) {
    ctx.beginPath();
    const [fx, fy] = w2s(pts[0].x, pts[0].y);
    ctx.moveTo(fx, fy);
    for (let i = 1; i < pts.length; i++) {
      const [sx, sy] = w2s(pts[i].x, pts[i].y);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = "#a371f712";
    ctx.fill();
  }

  if (pts.length >= 2) {
    ctx.beginPath();
    const [fx, fy] = w2s(pts[0].x, pts[0].y);
    ctx.moveTo(fx, fy);
    for (let i = 1; i < pts.length; i++) {
      const [sx, sy] = w2s(pts[i].x, pts[i].y);
      ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = "#a371f7";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (S.mousePt && pts.length > 0) {
    const last = pts[pts.length - 1];
    const [lx, ly] = w2s(last.x, last.y);
    const [mx, my] = w2s(S.mousePt.x, S.mousePt.y);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(mx, my);
    ctx.strokeStyle = "#a371f780";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  pts.forEach((pt, i) => {
    const [sx, sy] = w2s(pt.x, pt.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    const isFirst = i === 0;
    const nearFirst =
      isFirst && S.mousePt && pts.length >= 3 && nearStart(S.mousePt);
    ctx.fillStyle = nearFirst
      ? "#3fb950"
      : isFirst
        ? "#a371f7"
        : "#8b6fc7";
    ctx.fill();
    if (nearFirst) {
      ctx.strokeStyle = "#3fb950";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  ctx.restore();
}

/**
 * True when a mouse position is within the click-radius of the first
 * placed vertex (i.e. clicking now would close the polygon).
 *
 * @param {Pt} mp - Mouse position in world coordinates.
 * @returns {boolean}
 */
export function nearStart(mp) {
  if (!S.drawPts.length) return false;
  const f = S.drawPts[0];
  const [fsx, fsy] = w2s(f.x, f.y);
  const [msx, msy] = w2s(mp.x, mp.y);
  return Math.hypot(msx - fsx, msy - fsy) < 16;
}

/**
 * Paint all topology parcels (fills, error-colored outlines) plus
 * per-parcel measurement labels, rebuilding {@link AppState.labelHits}.
 *
 * @returns {void}
 */
export function drawTopo() {
  const drawnEdges = new Set();
  S.labelHits = [];
  S.topo.parcels.forEach((p, i) => {
    const ta = targetArea(i);
    const a = pArea(p);
    const ep = ta > 0 ? ((a - ta) / ta) * 100 : 0;
    const sel = S.selParcels.includes(i);

    ctx.save();
    ctx.beginPath();
    const v0 = S.topo.vertices[p.vids[0]];
    const [fx, fy] = w2s(v0.x, v0.y);
    ctx.moveTo(fx, fy);
    for (let k = 1; k < p.vids.length; k++) {
      const v = S.topo.vertices[p.vids[k]];
      const [sx, sy] = w2s(v.x, v.y);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();

    ctx.globalAlpha = sel ? 0.28 : 0.14;
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 1;

    const sc =
      Math.abs(ep) < 0.1
        ? "#3fb950"
        : Math.abs(ep) < 1
          ? p.color
          : "#f78166";
    ctx.strokeStyle = sel ? p.color : sc;
    ctx.lineWidth = sel ? 2.5 : 1.8;
    ctx.stroke();
    ctx.restore();

    drawLbl(p, a, ta, i);

    const showMLen = S.showPcLen[i] || S.hoveredParcelId === i;
    const showMAng = S.showPcAng[i] || S.hoveredParcelId === i;
    if (showMLen || showMAng) {
      ctx.save();
      ctx.font = `500 ${Math.max(9, S.zoom * 0.4)}px JetBrains Mono`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const nV = p.vids.length;

      let signedArea = 0;
      for (let k = 0, j = nV - 1; k < nV; j = k++) {
        const A = S.topo.vertices[p.vids[j]],
          B = S.topo.vertices[p.vids[k]];
        signedArea += A.x * B.y - B.x * A.y;
      }

      let cx = 0,
        cy = 0;
      p.vids.forEach((vi) => {
        cx += S.topo.vertices[vi].x;
        cy += S.topo.vertices[vi].y;
      });
      cx /= nV;
      cy /= nV;

      for (let k = 0; k < nV; k++) {
        const vA = S.topo.vertices[p.vids[k]];
        const vB = S.topo.vertices[p.vids[(k + 1) % nV]];
        const vC = S.topo.vertices[p.vids[(k + 2) % nV]];

        const dx = vB.x - vA.x,
          dy = vB.y - vA.y;
        const len = Math.hypot(dx, dy);
        const mx = vA.x + dx / 2,
          my = vA.y + dy / 2;
        const [smx, smy] = w2s(mx, my);

        let nx = -dy, ny = dx;
        if (signedArea < 0) { nx = dy; ny = -dx; }
        const nlen = Math.hypot(nx, ny) || 1;
        nx /= nlen; ny /= nlen;
        const edgeKey = Math.min(p.vids[k], p.vids[(k + 1) % nV]) + "-" + Math.max(p.vids[k], p.vids[(k + 1) % nV]);
        const loff = S.labelPos["l" + edgeKey] || { x: 0, y: 0 };
        const tx = smx - nx * 18 + loff.x;
        const ty = smy + ny * 18 + loff.y;

        const txtLen = `${(len * S.measScale).toFixed(2)}m`;
        const wLen = ctx.measureText(txtLen).width;

        const showMLen = S.showPcLen[i] || S.hoveredParcelId === i;
        if (showMLen && !drawnEdges.has(edgeKey)) {
          drawnEdges.add(edgeKey);
          S.labelHits.push({ key: "l" + edgeKey, x: tx - wLen / 2 - 3, y: ty - 7, w: wLen + 6, h: 14 });
          ctx.fillStyle = "#0d1117cc";
          ctx.fillRect(tx - wLen / 2 - 3, ty - 7, wLen + 6, 14);
          ctx.fillStyle = "#58a6ff";
          ctx.fillText(txtLen, tx, ty);
        }

        const baX = vA.x - vB.x,
          baY = vA.y - vB.y;
        const bcX = vC.x - vB.x,
          bcY = vC.y - vB.y;
        const dot = baX * bcX + baY * bcY;
        const cross = baX * bcY - baY * bcX;
        let angle = (Math.atan2(cross, dot) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        if (signedArea < 0) angle = 360 - angle;

        const [sbx, sby] = w2s(vB.x, vB.y);
        const vx = cx - vB.x,
          vy = cy - vB.y;
        const vlen = Math.hypot(vx, vy) || 1;
        const akey = "a" + p.vids[(k + 1) % nV];
        const aoff = S.labelPos[akey] || { x: 0, y: 0 };
        const ox = sbx + (vx / vlen) * 22 + aoff.x;
        const oy = sby - (vy / vlen) * 22 + aoff.y;

        const txtAng = `${Math.round(angle)}°`;
        const wAng = ctx.measureText(txtAng).width;

        const showMAng = S.showPcAng[i] || S.hoveredParcelId === i;
        if (showMAng) {
          S.labelHits.push({ key: akey, x: ox - wAng / 2 - 3, y: oy - 7, w: wAng + 6, h: 14 });
          ctx.fillStyle = "#0d1117cc";
          ctx.fillRect(ox - wAng / 2 - 3, oy - 7, wAng + 6, 14);
          ctx.fillStyle = "#d29922";
          ctx.fillText(txtAng, ox, oy);
        }
      }
      ctx.restore();
    }
  });
}

/**
 * Paint a parcel's center label block (name, area, error %) and record
 * its hitbox in `S.labelHits` for pan-tool dragging.
 *
 * @param {Parcel} p
 * @param {number} a - Current area (world units²).
 * @param {number} ta - Target area (world units²).
 * @param {number} idx - Parcel index (labels are keyed by it).
 * @returns {void}
 */
export function drawLbl(p, a, ta, idx) {
  let cx = 0,
    cy = 0;
  const n = p.vids.length;
  p.vids.forEach((i) => {
    cx += S.topo.vertices[i].x;
    cy += S.topo.vertices[i].y;
  });
  cx /= n;
  cy /= n;
  const [nsx, nsy] = w2s(cx, cy);
  const off = S.labelPos["p" + idx] || { x: 0, y: 0 };
  const sx = nsx + off.x;
  const sy = nsy + off.y;
  const fs = Math.max(9, Math.min(13, S.zoom * 1.6));
  const lo = S.lblOpacity;
  ctx.save();
  ctx.font = `500 ${fs}px Inter`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ep = ta > 0 ? ((a - ta) / ta) * 100 : 0;
  const aDisp = a * S.measScale * S.measScale;
  const lines = [
    p.label,
    `${aDisp.toFixed(1)} m²`,
    ep >= 0 ? `+${ep.toFixed(1)}%` : `${ep.toFixed(1)}%`,
  ];
  const lh = fs + 3;
  const totH = lines.length * lh;
  let maxW = 0;
  lines.forEach((txt, i) => {
    const y = sy - totH / 2 + i * lh + lh / 2;
    const w = ctx.measureText(txt).width;
    if (w > maxW) maxW = w;
    ctx.globalAlpha = 0.8 * lo;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(sx - w / 2 - 3, y - lh / 2, w + 6, lh);
    ctx.globalAlpha = lo;
    const col =
      i === 2
        ? Math.abs(ep) < 0.1
          ? "#3fb950"
          : Math.abs(ep) < 1
            ? "#d29922"
            : "#f78166"
        : p.color;
    ctx.fillStyle = col;
    ctx.fillText(txt, sx, y);
  });
  ctx.restore();
  S.labelHits.push({ key: "p" + idx, x: sx - maxW / 2 - 3, y: sy - totH / 2, w: maxW + 6, h: totH });
}

/**
 * Find the topmost label hitbox under screen coordinates (rebuilt by
 * {@link drawTopo}/{@link drawLbl} on every repaint).
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {{key: string, x: number, y: number, w: number, h: number}|null}
 */
export function hitLbl(sx, sy) {
  for (let i = S.labelHits.length - 1; i >= 0; i--) {
    const b = S.labelHits[i];
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h)
      return b;
  }
  return null;
}

/**
 * Paint locked (pinned) topology edges as dashed red segments with a
 * lock emoji at the midpoint.
 *
 * @returns {void}
 */
export function drawLockedEdges() {
  if (!S.topo || !S.lockedEdges) return;
  S.lockedEdges.forEach(le => {
    const vA = S.topo.vertices[le.v1];
    const vB = S.topo.vertices[le.v2];
    if (!vA || !vB) return;
    const [Asx, Asy] = w2s(vA.x, vA.y);
    const [Bsx, Bsy] = w2s(vB.x, vB.y);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Asx, Asy);
    ctx.lineTo(Bsx, Bsy);
    ctx.strokeStyle = "#f78166";
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();

    const sx = (Asx + Bsx) / 2;
    const sy = (Asy + Bsy) / 2;
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🔒", sx, sy);
  });
}

/**
 * Paint selection/hover overlays: selected & hovered edges, selected
 * vertices (with crosshair guides while dragging) in both `select` and
 * `edit-outer` tools.
 *
 * @returns {void}
 */
export function drawHandles() {
  if (S.tool !== "select" && S.tool !== "edit-outer") return;

  if (S.selEdges && S.selEdges.length > 0) {
    S.selEdges.forEach((ed) => {
      let A, B;
      if (ed.type === "topo") {
        A = S.topo.vertices[ed.v1];
        B = S.topo.vertices[ed.v2];
      } else {
        A = S.outerGeo[ed.i1];
        B = S.outerGeo[ed.i2];
      }
      const [Asx, Asy] = w2s(A.x, A.y);
      const [Bsx, Bsy] = w2s(B.x, B.y);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(Asx, Asy);
      ctx.lineTo(Bsx, Bsy);
      ctx.strokeStyle = "#f78166";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    });
  }

  if (S.hoverEdge && !S.dragVtx && !S.dragEdge) {
    let A, B;
    if (S.hoverEdge.type === "topo") {
      A = S.topo.vertices[S.hoverEdge.v1];
      B = S.topo.vertices[S.hoverEdge.v2];
    } else {
      A = S.outerGeo[S.hoverEdge.i1];
      B = S.outerGeo[S.hoverEdge.i2];
    }
    const [Asx, Asy] = w2s(A.x, A.y);
    const [Bsx, Bsy] = w2s(B.x, B.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Asx, Asy);
    ctx.lineTo(Bsx, Bsy);
    ctx.strokeStyle = "#58a6ff60";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  if (S.dragEdge) {
    let A, B;
    if (S.dragEdge.type === "topo") {
      A = S.topo.vertices[S.dragEdge.v1];
      B = S.topo.vertices[S.dragEdge.v2];
    } else {
      A = S.outerGeo[S.dragEdge.i1];
      B = S.outerGeo[S.dragEdge.i2];
    }
    const [Asx, Asy] = w2s(A.x, A.y);
    const [Bsx, Bsy] = w2s(B.x, B.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Asx, Asy);
    ctx.lineTo(Bsx, Bsy);
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  if (S.tool === "edit-outer" && S.outerGeo) {
    S.outerGeo.forEach((v, idx) => {
      const [sx, sy] = w2s(v.x, v.y);
      const isHover =
        S.hoverVtx &&
        S.hoverVtx.type === "outer" &&
        S.hoverVtx.id === idx;
      const isSel =
        S.selVtxs &&
        S.selVtxs.some((s) => s.type === "outer" && s.id === idx);
      const isDrag = isSel && S.dragVtx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        sx,
        sy,
        isDrag || isSel ? 7 : isHover ? 6 : 4,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#30363d";
      ctx.strokeStyle = "#d29922";
      ctx.lineWidth = 1.5;
      if (isSel) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#f78166";
        ctx.lineWidth = 2;
      } else if (isHover) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#d29922";
        ctx.lineWidth = 2;
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  if (S.tool === "select" && S.topo) {
    S.topo.vertices.forEach((v, idx) => {
      const [sx, sy] = w2s(v.x, v.y);
      const isHover =
        S.hoverVtx && S.hoverVtx.type === "topo" && S.hoverVtx.id === idx;
      const isSel =
        S.selVtxs &&
        S.selVtxs.some((s) => s.type === "topo" && s.id === idx);
      const isDrag = isSel && S.dragVtx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        sx,
        sy,
        isDrag || isSel ? 7 : isHover ? 6 : 4,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#30363d";
      ctx.strokeStyle = "#a371f7";
      ctx.lineWidth = 1.5;
      if (isSel) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#f78166";
        ctx.lineWidth = 2;
      } else if (isHover) {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#a371f7";
        ctx.lineWidth = 2;
      }
      ctx.fill();
      ctx.stroke();
      if (isDrag) {
        ctx.strokeStyle = "#f7816640";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(canvas.width, sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    });
  }
}
