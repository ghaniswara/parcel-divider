/**
 * @module interactions
 * All pointer/keyboard handling for the main canvas: vertex & edge
 * selection and dragging (with locked-edge constraints and Alt edge
 * sliding), background-image transforms, label dragging, panning,
 * polygon/parcel drawing clicks, calibration, hover feedback, zoom and
 * the Delete-key shortcut.
 *
 * Ported from gui/index.html v1 with behavior parity. DOM writes that
 * belong to other components (coords readout, background input values,
 * scale label) are replaced by {@link module:events} emits; redundant
 * `updatePcList()` calls after `draw()` are dropped.
 */

import { S } from "./state.js";
import { s2w } from "./transform.js";
import { hitVtx, hitEdge, hitBg, sameVtx, enforceInsideAndSnap, pip } from "./hit.js";
import { closestPointOnSeg } from "./math.js";
import { draw, hitLbl, nearStart } from "./render.js";
import { isLocked, closeDraw, closeDrawParcel, deleteSelected, doZoom } from "./actions.js";
import { runEq } from "./api.js";
import { toast, notifyDrawStatus } from "./ui.js";
import { emit } from "./events.js";

/**
 * Wire every v1 canvas/window listener onto the given canvas. Called
 * once by `<pee-canvas>` after `render.init`.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {void}
 */
export function attach(canvas) {
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const [wx, wy] = s2w(sx, sy);
    S.mousePt = { x: wx, y: wy };
    emit("coords", { text: `${wx.toFixed(2)}, ${wy.toFixed(2)}` });

    // Dragging selected vertices
    if (S.dragVtx && S.selVtxsInit) {
      // Calculate the target position of the primarily dragged vertex
      const primaryInit = S.selVtxsInit.find(
        (v) => v.type === S.dragVtx.type && v.id === S.dragVtx.id,
      );
      let targetPos = enforceInsideAndSnap(wx, wy, e, S.dragVtx);

      let maxLocks = 0;
      let constraintLine = null;
      if (S.lockedEdges) {
        S.selVtxsInit.forEach(sv => {
          if (sv.type === "topo") {
            const conns = S.lockedEdges.filter(le => le.v1 === sv.id || le.v2 === sv.id);
            if (conns.length > maxLocks) maxLocks = conns.length;
            if (conns.length === 1 && !constraintLine) {
              const le = conns[0];
              const otherVid = le.v1 === sv.id ? le.v2 : le.v1;
              const otherInit = S.selVtxsInit.find(v => v.type === "topo" && v.id === otherVid);
              const Ax = sv.ox, Ay = sv.oy;
              const Bx = otherInit ? otherInit.ox : S.topo.vertices[otherVid].x;
              const By = otherInit ? otherInit.oy : S.topo.vertices[otherVid].y;
              constraintLine = { Ax, Ay, Bx, By, sv };
            }
          }
        });
      }

      if (maxLocks >= 2) {
        targetPos = { x: primaryInit.ox, y: primaryInit.oy };
      } else if (maxLocks === 1 && constraintLine) {
        const svWantsX = constraintLine.sv.ox + (targetPos.x - primaryInit.ox);
        const svWantsY = constraintLine.sv.oy + (targetPos.y - primaryInit.oy);
        const dx = constraintLine.Bx - constraintLine.Ax;
        const dy = constraintLine.By - constraintLine.Ay;
        const l2 = dx * dx + dy * dy;
        if (l2 > 0) {
          const t = ((svWantsX - constraintLine.Ax) * dx + (svWantsY - constraintLine.Ay) * dy) / l2;
          const svSnappedX = constraintLine.Ax + t * dx;
          const svSnappedY = constraintLine.Ay + t * dy;
          targetPos = {
            x: primaryInit.ox + (svSnappedX - constraintLine.sv.ox),
            y: primaryInit.oy + (svSnappedY - constraintLine.sv.oy)
          };
        }
      }

      if (e.altKey && S.selEdges && S.selEdges.length === 1) {
        const ed = S.selEdges[0];
        let A, B;
        if (ed.type === "topo") {
          A = S.topo.vertices[ed.v1];
          B = S.topo.vertices[ed.v2];
        } else {
          A = S.outerGeo[ed.i1];
          B = S.outerGeo[ed.i2];
        }
        const dx = B.x - A.x,
          dy = B.y - A.y;
        const l2 = dx * dx + dy * dy;
        if (l2 > 0) {
          const t = ((wx - A.x) * dx + (wy - A.y) * dy) / l2;
          targetPos = { x: A.x + t * dx, y: A.y + t * dy };
        }
      }

      const dx = targetPos.x - primaryInit.ox;
      const dy = targetPos.y - primaryInit.oy;

      // Apply translation to all selected vertices
      S.selVtxsInit.forEach((sv) => {
        if (sv.type === "topo" && S.topo) {
          S.topo.vertices[sv.id].x = sv.ox + dx;
          S.topo.vertices[sv.id].y = sv.oy + dy;
        } else if (sv.type === "outer" && S.outerGeo) {
          S.outerGeo[sv.id].x = sv.ox + dx;
          S.outerGeo[sv.id].y = sv.oy + dy;
        }
      });

      draw();
      return;
    }

    // Dragging edge
    if (S.dragEdge) {
      if (S.dragEdge.type === "topo" && isLocked(S.dragEdge)) return;
      const { mx, my } = S.dragEdge;
      const dx = wx - mx,
        dy = wy - my;

      if (S.dragEdge.type === "topo") {
        const { v1, v2, ov1, ov2 } = S.dragEdge;
        const ex = ov2.x - ov1.x,
          ey = ov2.y - ov1.y;
        const len = Math.hypot(ex, ey);
        if (len > 1e-6) {
          const nx = -ey / len,
            ny = ex / len;
          const dist = dx * nx + dy * ny;
          const P0_1 = { x: ov1.x + nx * dist, y: ov1.y + ny * dist };
          const P0_2 = { x: ov2.x + nx * dist, y: ov2.y + ny * dist };
          const pos1 = enforceInsideAndSnap(P0_1.x, P0_1.y, e, {
            type: "topo",
            id: v1,
          });
          const pos2 = enforceInsideAndSnap(P0_2.x, P0_2.y, e, {
            type: "topo",
            id: v2,
          });
          S.topo.vertices[v1].x = pos1.x;
          S.topo.vertices[v1].y = pos1.y;
          S.topo.vertices[v2].x = pos2.x;
          S.topo.vertices[v2].y = pos2.y;
        }
      } else if (S.dragEdge.type === "outer") {
        const { i1, i2, ov1, ov2 } = S.dragEdge;
        const ex = ov2.x - ov1.x,
          ey = ov2.y - ov1.y;
        const len = Math.hypot(ex, ey);
        if (len > 1e-6) {
          const nx = -ey / len,
            ny = ex / len;
          const dist = dx * nx + dy * ny;
          const P0_1 = { x: ov1.x + nx * dist, y: ov1.y + ny * dist };
          const P0_2 = { x: ov2.x + nx * dist, y: ov2.y + ny * dist };
          const pos1 = enforceInsideAndSnap(P0_1.x, P0_1.y, e, {
            type: "outer",
            id: i1,
          });
          const pos2 = enforceInsideAndSnap(P0_2.x, P0_2.y, e, {
            type: "outer",
            id: i2,
          });
          S.outerGeo[i1].x = pos1.x;
          S.outerGeo[i1].y = pos1.y;
          S.outerGeo[i2].x = pos2.x;
          S.outerGeo[i2].y = pos2.y;
        }
      }
      draw();
      return;
    }

    // Dragging Background
    if (S.dragBg) {
      const o = S.dragBgStart.bgo;

      if (S.dragBg.type === "bg-body") {
        const dx = wx - S.dragBgStart.wx;
        const dy = wy - S.dragBgStart.wy;
        S.bg.x = o.x + dx;
        S.bg.y = o.y + dy;
        emit("bg");
      } else if (S.dragBg.type === "bg-corner") {
        const dxStart = S.dragBgStart.wx - o.x;
        const dyStart = S.dragBgStart.wy - o.y;
        const angStart = Math.atan2(dyStart, dxStart);

        const dxCurr = wx - o.x;
        const dyCurr = wy - o.y;
        const angCurr = Math.atan2(dyCurr, dxCurr);

        let diff = angCurr - angStart;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        S.bg.rot = o.rot + (diff * 180 / Math.PI);
        emit("bg");
      } else if (S.dragBg.type === "bg-edge") {
        const dxStart = S.dragBgStart.wx - o.x;
        const dyStart = S.dragBgStart.wy - o.y;
        const distStart = Math.hypot(dxStart, dyStart) || 1;

        const dxCurr = wx - o.x;
        const dyCurr = wy - o.y;
        const distCurr = Math.hypot(dxCurr, dyCurr);

        if (distCurr > 0.01) {
          S.bg.scale = o.scale * (distCurr / distStart);
        }
      }
      draw();
      return;
    }

    // Dragging a label
    if (S.dragLbl) {
      const o = S.labelPos[S.dragLbl.key];
      o.x = S.dragLbl.ox + (sx - S.dragLbl.sx);
      o.y = S.dragLbl.oy + (sy - S.dragLbl.sy);
      draw();
      return;
    }

    // Panning
    if (S.dragPan) {
      S.pan.x = S.dragPan.px - (e.clientX - S.dragPan.sx) / S.zoom;
      S.pan.y = S.dragPan.py + (e.clientY - S.dragPan.sy) / S.zoom;
      draw();
      return;
    }

    // Hover
    if (S.tool === "edit-bg") {
      const hit = hitBg(sx, sy);
      if (hit) {
        if (hit.type === "bg-corner") {
          canvas.style.cursor = "crosshair";
        } else if (hit.type === "bg-edge") {
          const absRot = Math.abs(S.bg.rot) % 180;
          const isRotated = absRot > 45 && absRot < 135;
          let isVert = (hit.id === "t" || hit.id === "b");
          if (isRotated) isVert = !isVert;
          canvas.style.cursor = isVert ? "ns-resize" : "ew-resize";
        } else {
          canvas.style.cursor = "move";
        }
      } else {
        canvas.style.cursor = "default";
      }
      return;
    }

    const prevVtx = S.hoverVtx,
      prevE = S.hoverEdge;
    S.hoverVtx = null;
    S.hoverEdge = null;
    if (S.dragMode && (S.tool === "select" || S.tool === "edit-outer")) {
      S.hoverVtx = hitVtx(sx, sy);
      if (!S.hoverVtx) S.hoverEdge = hitEdge(sx, sy);
    } else if (S.tool === "calibrate") {
      S.hoverEdge = hitEdge(sx, sy);
    }

    const lblHit = S.tool === "pan" ? hitLbl(sx, sy) : null;
    canvas.style.cursor =
      S.tool === "calibrate" && S.hoverEdge
        ? "pointer"
        : lblHit
          ? "grab"
          : S.hoverVtx || S.hoverEdge
            ? "grab"
            : S.tool === "draw" || S.tool === "draw-parcel"
              ? "crosshair"
              : "default";

    const edgeStr = S.hoverEdge
      ? S.hoverEdge.type === "topo"
        ? `${S.hoverEdge.v1},${S.hoverEdge.v2}`
        : `o${S.hoverEdge.i1},o${S.hoverEdge.i2}`
      : "";
    const prevEdgeStr = prevE
      ? prevE.type === "topo"
        ? `${prevE.v1},${prevE.v2}`
        : `o${prevE.i1},o${prevE.i2}`
      : "";
    if (!sameVtx(S.hoverVtx, prevVtx) || edgeStr !== prevEdgeStr) draw();
    else if (S.tool === "draw" || S.tool === "draw-parcel") draw();
  });

  canvas.addEventListener("mousedown", (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const [wx, wy] = s2w(sx, sy);

    if (S.tool === "draw" || S.tool === "draw-parcel") {
      return;
    }

    if (S.tool === "edit-bg") {
      const hit = hitBg(sx, sy);
      if (hit) {
        S.dragBg = hit;
        S.dragBgStart = { wx, wy, bgo: { ...S.bg } };
        canvas.style.cursor = "grabbing";
        return;
      }
    }

    if (S.dragMode && (S.tool === "select" || S.tool === "edit-outer")) {
      const vtx = hitVtx(sx, sy);
      if (vtx) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Toggle selection
          const existingIdx = S.selVtxs.findIndex(
            (v) => v.type === vtx.type && v.id === vtx.id,
          );
          if (existingIdx >= 0) S.selVtxs.splice(existingIdx, 1);
          else S.selVtxs.push(vtx);
        } else {
          // Replace selection if clicking unselected vertex
          if (
            !S.selVtxs.some((v) => v.type === vtx.type && v.id === vtx.id)
          ) {
            S.selVtxs = [vtx];
          }
        }

        if (S.selVtxs.some((v) => v.type === vtx.type && v.id === vtx.id)) {
          S.dragVtx = vtx;
          S.dragStartPos = { wx, wy };
          S.selVtxsInit = S.selVtxs.map((sv) => {
            if (sv.type === "topo")
              return {
                ...sv,
                ox: S.topo.vertices[sv.id].x,
                oy: S.topo.vertices[sv.id].y,
              };
            else
              return {
                ...sv,
                ox: S.outerGeo[sv.id].x,
                oy: S.outerGeo[sv.id].y,
              };
          });
          canvas.style.cursor = "grabbing";
        } else {
          S.dragVtx = null;
          S.selVtxsInit = null;
        }
        draw();
        return;
      }

      // Clear selection if clicked empty space
      if (!hitEdge(sx, sy)) {
        S.selVtxs = [];
        S.selEdges = [];
        draw();
      }

      const edge = hitEdge(sx, sy);
      if (edge) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          const idx = S.selEdges.findIndex(
            (ed) =>
              ed.type === edge.type &&
              (ed.type === "topo"
                ? ed.v1 === edge.v1 && ed.v2 === edge.v2
                : ed.i1 === edge.i1 && ed.i2 === edge.i2),
          );
          if (idx >= 0) S.selEdges.splice(idx, 1);
          else S.selEdges.push(edge);
          draw();
          return;
        }

        if (
          !S.selEdges.some(
            (ed) =>
              ed.type === edge.type &&
              (ed.type === "topo"
                ? ed.v1 === edge.v1 && ed.v2 === edge.v2
                : ed.i1 === edge.i1 && ed.i2 === edge.i2),
          )
        ) {
          S.selEdges = [edge];
        }

        if (edge.type === "topo") {
          const [v1, v2] = [edge.v1, edge.v2];
          S.dragEdge = {
            type: "topo",
            v1,
            v2,
            ov1: { x: S.topo.vertices[v1].x, y: S.topo.vertices[v1].y },
            ov2: { x: S.topo.vertices[v2].x, y: S.topo.vertices[v2].y },
            mx: wx,
            my: wy,
          };
        } else if (edge.type === "outer") {
          const [i1, i2] = [edge.i1, edge.i2];
          S.dragEdge = {
            type: "outer",
            i1,
            i2,
            ov1: { x: S.outerGeo[i1].x, y: S.outerGeo[i1].y },
            ov2: { x: S.outerGeo[i2].x, y: S.outerGeo[i2].y },
            mx: wx,
            my: wy,
          };
        }
        S.selVtxs = []; // clear vertex selection when dragging edge
        canvas.style.cursor = "grabbing";
        draw();
        return;
      }
    }
    if (S.tool === "pan") {
      const hb = hitLbl(sx, sy);
      if (hb) {
        if (!S.labelPos[hb.key]) S.labelPos[hb.key] = { x: 0, y: 0 };
        S.dragLbl = {
          key: hb.key,
          sx,
          sy,
          ox: S.labelPos[hb.key].x,
          oy: S.labelPos[hb.key].y,
        };
        canvas.style.cursor = "grabbing";
        return;
      }
    }
    S.dragPan = { sx: e.clientX, sy: e.clientY, px: S.pan.x, py: S.pan.y };
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("mouseup", async (e) => {
    const wasVtx = S.dragVtx !== null,
      wasEdge = S.dragEdge !== null;
    S.dragVtx = null;
    S.dragPan = null;
    S.dragEdge = null;
    S.dragLbl = null;
    S.selVtxsInit = null;
    S.dragBg = null;
    canvas.style.cursor = "default";
    draw();
    if ((wasVtx || wasEdge) && S.liveEq) await runEq();
  });

  let lastClick = 0;

  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const [wx, wy] = s2w(sx, sy);
    const now = Date.now();
    const dbl = now - lastClick < 350;
    lastClick = now;

    if (S.tool === "calibrate") {
      const edge = hitEdge(sx, sy);
      if (edge) {
        let A, B;
        if (edge.type === "topo") {
          A = S.topo.vertices[edge.v1];
          B = S.topo.vertices[edge.v2];
        } else {
          A = S.outerGeo[edge.i1];
          B = S.outerGeo[edge.i2];
        }
        const currentLen = Math.hypot(B.x - A.x, B.y - A.y);
        const actLen = currentLen * S.measScale;
        const val = prompt("Enter the actual distance for this edge (m):", actLen.toFixed(2));
        if (val !== null) {
          const num = parseFloat(val);
          if (!isNaN(num) && num > 0) {
            S.measScale = num / currentLen;
            emit("scale", { value: S.measScale });
            toast("Numbering calibrated to " + num + "m", "ok");
            draw();
            notifyDrawStatus();
          }
        }
      }
      return;
    }

    if (S.tool === "draw" || S.tool === "draw-parcel") {
      const isParcel = S.tool === "draw-parcel";
      if (dbl && S.drawPts.length >= 3) {
        isParcel ? closeDrawParcel() : closeDraw();
        return;
      }
      if (S.drawPts.length >= 3 && nearStart({ x: wx, y: wy })) {
        isParcel ? closeDrawParcel() : closeDraw();
        return;
      }
      S.drawPts.push({ x: wx, y: wy });
      if (!isParcel) notifyDrawStatus();
      draw();
      return;
    }

    if (
      (S.tool === "select" || S.tool === "edit-outer") &&
      !S.dragVtx &&
      !S.dragEdge
    ) {
      if (dbl) {
        const edge = hitEdge(sx, sy);
        if (edge) {
          if (edge.type === "topo") {
            const { v1, v2 } = edge;
            const cp = closestPointOnSeg(
              { x: wx, y: wy },
              S.topo.vertices[v1],
              S.topo.vertices[v2],
            );
            const newV = enforceInsideAndSnap(cp.x, cp.y, e);
            const newVid = S.topo.vertices.length;
            S.topo.vertices.push(newV);
            S.topo.parcels.forEach((p) => {
              for (let i = 0; i < p.vids.length; i++) {
                const a = p.vids[i],
                  b = p.vids[(i + 1) % p.vids.length];
                if ((a === v1 && b === v2) || (a === v2 && b === v1)) {
                  p.vids.splice(i + 1, 0, newVid);
                  break;
                }
              }
            });
            toast("Vertex added", "ok");
            draw();
            return;
          } else if (edge.type === "outer") {
            const { i1, i2 } = edge;
            const cp = closestPointOnSeg(
              { x: wx, y: wy },
              S.outerGeo[i1],
              S.outerGeo[i2],
            );
            const insertIdx = i2 === 0 ? S.outerGeo.length : i2;
            S.outerGeo.splice(insertIdx, 0, { x: cp.x, y: cp.y });
            toast("Outer vertex added", "ok");
            draw();
            return;
          }
        }
      }
      if (S.tool === "select" && !hitVtx(sx, sy)) {
        let hit = -1;
        S.topo?.parcels.forEach((p, i) => {
          if (hit < 0 && pip(wx, wy, p)) hit = i;
        });
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (hit >= 0) {
          if (additive) {
            const k = S.selParcels.indexOf(hit);
            if (k >= 0) S.selParcels.splice(k, 1);
            else S.selParcels.push(hit);
          } else {
            S.selParcels = [hit];
          }
          draw();
        } else if (!additive && S.selParcels.length) {
          S.selParcels = [];
          draw();
        }
      }
    }
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      doZoom(e.deltaY < 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "SELECT"
    )
      return;
    if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelected();
    }
  });
}
