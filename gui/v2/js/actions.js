/**
 * @module actions
 * User-intent operations: tool switching, drawing closure, splitting,
 * geometry surgery (join/delete/combine/parallel/lock), background image
 * loading, calibration, targets and view controls.
 *
 * Ported from gui/index.html v1 with behavior parity. v1's direct DOM
 * writes to other components are replaced by {@link module:events} emits;
 * v1's redundant `updatePcList()` calls after `draw()` are dropped (the
 * v2 `draw()` wrapper already notifies the parcel panel).
 */

import { S, COLORS } from "./state.js";
import { EXAMPLES } from "./examples.js";
import { lineIntersection, polyArea, splitPolyH, splitPolyV, splitPolyAuto } from "./math.js";
import { buildTopo, pArea, getAdjVertex } from "./topology.js";
import { draw, drawCore, getCanvas } from "./render.js";
import { toast, logOk, logA, setStep, notifyDrawStatus } from "./ui.js";
import { emit } from "./events.js";

/**
 * Switch the active tool. Clears vertex/edge selections when leaving a
 * selection-ish tool (v1 parity), syncs toolbar buttons via the `tool`
 * event and repaints.
 *
 * @param {AppState['tool']} t
 * @returns {void}
 */
export function setTool(t) {
  if (S.tool !== t && S.tool !== "pan" && t !== "pan") {
    S.selEdges = [];
    S.selVtxs = [];
    S.hoverEdge = null;
    S.hoverVtx = null;
    S.dragVtx = null;
    S.dragEdge = null;
    emit("selection");
  }
  S.tool = t;
  emit("tool", { tool: t });
  draw();
}

/**
 * Split the outer polygon into N strip parcels and build a new topology.
 * Reads the lot count from the sidebar's `#n-range` input and the
 * direction from `#split-dir` (same reads as v1).
 *
 * @returns {void}
 */
export function doSplit() {
  const outer = S.outerGeo;
  if (!outer || outer.length < 3) {
    toast("Draw or load a polygon first", "er");
    return;
  }
  const n = parseInt(document.getElementById("n-range").value) || 3;
  const dir = document.getElementById("split-dir").value;

  let parts;
  if (dir === "h") parts = splitPolyH(outer, n);
  else if (dir === "v") parts = splitPolyV(outer, n);
  else parts = splitPolyAuto(outer, n);

  if (!parts.length) {
    toast("Split produced no valid parcels", "er");
    return;
  }

  const outerRing = outer.map((v) => [v.x, v.y]);
  outerRing.push(outerRing[0]);
  const geo = {
    outer: { type: "Polygon", coordinates: [outerRing] },
    parcels: parts.map((pts) => {
      const ring = pts.map((v) => [v.x, v.y]);
      ring.push(ring[0]);
      return { type: "Polygon", coordinates: [ring] };
    }),
  };

  S.topo = buildTopo(geo);
  S.selParcels = [];
  S.selVtxs = [];
  S.showPcLen = {};
  S.showPcAng = {};
  S.targetPcts = {};
  setStep(3);
  emit("hint", { visible: false });
  logA(
    `Split into ${n} lots (${dir}), areas: ${S.topo.parcels.map((p) => (pArea(p) * S.measScale * S.measScale).toFixed(1)).join(", ")}`,
  );
  toast(`${n} lots created — drag vertices or click Equalize`, "ok");
  fitView();
}

/**
 * Close the in-progress outer polygon: freeze `S.drawPts` into
 * `S.outerGeo`, mark ready to split.
 *
 * @returns {void}
 */
export function closeDraw() {
  if (S.drawPts.length < 3) {
    toast("Need at least 3 points", "er");
    return;
  }
  S.outerGeo = [...S.drawPts];
  S.drawPts = [];
  S.drawDone = true;
  emit("split-ready", { ready: true });
  notifyDrawStatus();
  setStep(2);
  const aDisp = polyArea(S.outerGeo) * S.measScale * S.measScale;
  logA(
    `Outer polygon drawn (${S.outerGeo.length} vertices, area ${aDisp.toFixed(1)} m²)`,
  );
  toast("Polygon closed — set N and Split", "ok");
  draw();
}

/**
 * Insert an existing vertex id into every parcel ring whose boundary it
 * lies on (keeps rings connected after drawing a parcel that shares an
 * edge corner).
 *
 * @param {number} vid
 * @returns {void}
 */
export function insertVidOnParcelEdges(vid) {
  const v = S.topo.vertices[vid];
  S.topo.parcels.forEach((p) => {
    if (p.vids.includes(vid)) return;
    for (let i = 0; i < p.vids.length; i++) {
      const a = p.vids[i],
        b = p.vids[(i + 1) % p.vids.length];
      const A = S.topo.vertices[a],
        B = S.topo.vertices[b];
      const abx = B.x - A.x,
        aby = B.y - A.y;
      const l2 = abx * abx + aby * aby;
      if (l2 === 0) continue;
      const t = ((v.x - A.x) * abx + (v.y - A.y) * aby) / l2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const px = A.x + t * abx,
        py = A.y + t * aby;
      if (Math.hypot(v.x - px, v.y - py) < 1e-6 * Math.sqrt(l2)) {
        p.vids.splice(i + 1, 0, vid);
        break;
      }
    }
  });
}

/**
 * Close the in-progress parcel polygon. Without a topology yet, the
 * parcel becomes the first lot (outer boundary adopted); otherwise the
 * ring is merged into the existing topology, reusing coincident vertices
 * and splitting edges it terminates on.
 *
 * @returns {void}
 */
export function closeDrawParcel() {
  if (S.drawPts.length < 3) {
    toast("Need at least 3 points", "er");
    return;
  }
  const PREC = 1e7;
  const pts = S.drawPts.map((p) => ({ x: p.x, y: p.y }));
  S.drawPts = [];
  const ring = (arr) => {
    const r = arr.map((p) => [p.x, p.y]);
    r.push(r[0]);
    return r;
  };

  if (!S.topo) {
    const outerPts = S.outerGeo
      ? S.outerGeo.map((p) => ({ x: p.x, y: p.y }))
      : pts.map((p) => ({ x: p.x, y: p.y }));
    const geo = {
      outer: { type: "Polygon", coordinates: [ring(outerPts)] },
      parcels: [{ type: "Polygon", coordinates: [ring(pts)] }],
    };
    S.topo = buildTopo(geo);
    S.outerGeo = S.topo.outer;
    S.drawDone = true;
    emit("split-ready", { ready: true });
    emit("hint", { visible: false });
    S.selParcels = [0];
    setStep(3);
    notifyDrawStatus();
    const aDisp =
      pArea(S.topo.parcels[0]) * S.measScale * S.measScale;
    logA(
      `Parcel drawn directly (${S.topo.parcels[0].vids.length} vertices, area ${aDisp.toFixed(1)} m²)`,
    );
    toast("Parcel created — no split needed", "ok");
    draw();
    return;
  }

  const vmap = new Map();
  S.topo.vertices.forEach((v, i) => {
    const k = `${Math.round(v.x * PREC) / PREC},${Math.round(v.y * PREC) / PREC}`;
    vmap.set(k, i);
  });
  const vids = pts.map((p) => {
    const k = `${Math.round(p.x * PREC) / PREC},${Math.round(p.y * PREC) / PREC}`;
    if (!vmap.has(k)) {
      vmap.set(k, S.topo.vertices.length);
      S.topo.vertices.push({ x: p.x, y: p.y });
    }
    return vmap.get(k);
  });

  const clean = [];
  vids.forEach((v) => {
    if (clean[clean.length - 1] !== v) clean.push(v);
  });
  if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
  if (clean.length < 3) {
    toast("Parcel needs at least 3 distinct corners", "er");
    return;
  }

  const n = S.topo.parcels.length;
  S.topo.parcels.push({
    vids: clean,
    color: COLORS[n % COLORS.length],
    label: `Lot ${n}`,
  });
  clean.forEach((v) => insertVidOnParcelEdges(v));
  S.selParcels = [n];
  setStep(3);
  const aDisp = pArea(S.topo.parcels[n]) * S.measScale * S.measScale;
  logA(
    `Parcel drawn (${clean.length} vertices, area ${aDisp.toFixed(1)} m²)`,
  );
  toast("Parcel added", "ok");
  draw();
}

/**
 * Prompt for a new label and rename parcel `i`.
 *
 * @param {number} i - Parcel index.
 * @returns {void}
 */
export function renameParcel(i) {
  if (!S.topo || !S.topo.parcels[i]) return;
  const cur = S.topo.parcels[i].label;
  const nn = prompt("Parcel name:", cur);
  if (nn === null) return;
  const name = nn.trim();
  if (!name) {
    toast("Name cannot be empty", "er");
    return;
  }
  S.topo.parcels[i].label = name;
  draw();
  toast("Parcel renamed", "ok");
}

/**
 * Clear all drawing/geometry state and reset to step 1 (Draw).
 *
 * @returns {void}
 */
export function clearDraw() {
  S.drawPts = [];
  S.drawDone = false;
  S.outerGeo = null;
  S.topo = null;
  S.selParcels = [];
  S.selVtxs = [];
  S.selEdges = [];
  S.showPcLen = {};
  S.showPcAng = {};
  S.targetPcts = {};
  S.lockedEdges = [];
  emit("split-ready", { ready: false });
  emit("hint", { visible: true });
  emit("parcels");
  setStep(1);
  notifyDrawStatus();
  draw();
}

/**
 * Reset geometry state (softer than {@link clearDraw}: keeps drawing
 * settings, clears hover/drag refs). v1 parity note: `S.selEdges` is
 * intentionally not reset here.
 *
 * @returns {void}
 */
export function resetAll() {
  S.topo = null;
  S.outerGeo = null;
  S.drawPts = [];
  S.drawDone = false;
  S.selParcels = [];
  S.selVtxs = [];
  S.showPcLen = {};
  S.showPcAng = {};
  S.targetPcts = {};
  S.hoverVtx = null;
  S.dragVtx = null;
  S.dragEdge = null;
  S.hoverEdge = null;
  S.lockedEdges = [];
  emit("split-ready", { ready: false });
  emit("hint", { visible: true });
  emit("parcels");
  setStep(1);
  notifyDrawStatus();
  draw();
}

/**
 * Load a built-in example geometry by key (see {@link module:examples}).
 *
 * @param {string} key - One of "3lot", "5lot", "lshape", "fan".
 * @returns {void}
 */
export function loadEx(key) {
  const geo = EXAMPLES[key];
  S.drawPts = [];
  S.drawDone = false;
  S.outerGeo = geo.outer.coordinates[0]
    .slice(0, -1)
    .map(([x, y]) => ({ x, y }));
  S.topo = buildTopo(geo);
  S.selParcels = [];
  S.selVtxs = [];
  S.showPcLen = {};
  S.showPcAng = {};
  S.targetPcts = {};
  emit("split-ready", { ready: true });
  emit("hint", { visible: false });
  setStep(3);
  notifyDrawStatus();
  fitView();
  logA(`Example "${key}" loaded (${S.topo.parcels.length} parcels)`);
  toast(`${key} loaded`, "ok");
}

/**
 * Remove vertices (by id) from the topology, reindexing parcel vids and
 * locked edges.
 *
 * @param {number[]} vidsToRemove
 * @returns {void}
 */
export function deleteVertices(vidsToRemove) {
  if (!S.topo || !vidsToRemove.length) return;
  const sorted = [...new Set(vidsToRemove)].sort((a, b) => b - a);
  sorted.forEach((vid) => {
    S.topo.parcels.forEach((p) => {
      p.vids = p.vids.filter((id) => id !== vid);
    });
    if (S.lockedEdges) {
      S.lockedEdges = S.lockedEdges.filter(le => le.v1 !== vid && le.v2 !== vid);
      S.lockedEdges.forEach(le => {
        if (le.v1 > vid) le.v1--;
        if (le.v2 > vid) le.v2--;
      });
    }
    S.topo.vertices.splice(vid, 1);
    S.topo.parcels.forEach((p) => {
      p.vids = p.vids.map((id) => (id > vid ? id - 1 : id));
    });
  });
}

/**
 * Remove vertices (by index) from the outer polygon ring.
 *
 * @param {number[]} idxsToRemove
 * @returns {void}
 */
export function deleteOuterVertices(idxsToRemove) {
  if (!S.outerGeo || !idxsToRemove.length) return;
  const sorted = [...new Set(idxsToRemove)].sort((a, b) => b - a);
  sorted.forEach((idx) => {
    S.outerGeo.splice(idx, 1);
  });
}

/**
 * Delete every selected vertex (topology + outer).
 *
 * @returns {void}
 */
export function deleteSelected() {
  if (!S.selVtxs || !S.selVtxs.length) return;
  const topos = S.selVtxs
    .filter((v) => v.type === "topo")
    .map((v) => v.id);
  const outers = S.selVtxs
    .filter((v) => v.type === "outer")
    .map((v) => v.id);
  if (topos.length) deleteVertices(topos);
  if (outers.length) deleteOuterVertices(outers);
  S.selVtxs = [];
  S.hoverVtx = null;
  toast("Deleted", "ok");
  draw();
}

/**
 * Join all selected topology vertices into the first one, honoring
 * locked-edge constraints (fully-locked vertex wins, single lock
 * constrains to its line, otherwise centroid).
 *
 * @returns {void}
 */
export function joinSelected() {
  const topos = S.selVtxs
    .filter((v) => v.type === "topo")
    .map((v) => v.id);
  if (topos.length < 2) {
    toast("Select at least 2 topology vertices", "er");
    return;
  }

  const targetId = topos[0];
  let targetVtx = S.topo.vertices[targetId];

  let cx = 0,
    cy = 0;
  topos.forEach((id) => {
    cx += S.topo.vertices[id].x;
    cy += S.topo.vertices[id].y;
  });
  cx /= topos.length;
  cy /= topos.length;

  let maxLocks = 0;
  let constraintLine = null;
  if (S.lockedEdges) {
    topos.forEach(id => {
      const conns = S.lockedEdges.filter(le => le.v1 === id || le.v2 === id);
      if (conns.length > maxLocks) maxLocks = conns.length;
      if (conns.length === 1 && !constraintLine) {
        const le = conns[0];
        const otherVid = le.v1 === id ? le.v2 : le.v1;
        constraintLine = {
          Ax: S.topo.vertices[id].x, Ay: S.topo.vertices[id].y,
          Bx: S.topo.vertices[otherVid].x, By: S.topo.vertices[otherVid].y
        };
      }
    });
  }

  if (maxLocks >= 2) {
    const constrainedId = topos.find(id => S.lockedEdges.filter(le => le.v1 === id || le.v2 === id).length >= 2);
    targetVtx.x = S.topo.vertices[constrainedId].x;
    targetVtx.y = S.topo.vertices[constrainedId].y;
  } else if (maxLocks === 1 && constraintLine) {
    const dx = constraintLine.Bx - constraintLine.Ax;
    const dy = constraintLine.By - constraintLine.Ay;
    const l2 = dx * dx + dy * dy;
    if (l2 > 0) {
      const t = ((cx - constraintLine.Ax) * dx + (cy - constraintLine.Ay) * dy) / l2;
      targetVtx.x = constraintLine.Ax + t * dx;
      targetVtx.y = constraintLine.Ay + t * dy;
    }
  } else {
    targetVtx.x = cx;
    targetVtx.y = cy;
  }

  const toDelete = topos.slice(1);
  toDelete.forEach((dragId) => {
    S.topo.parcels.forEach((p) => {
      p.vids = p.vids.map((id) => (id === dragId ? targetId : id));
    });
    if (S.lockedEdges) {
      S.lockedEdges.forEach(le => {
        if (le.v1 === dragId) le.v1 = targetId;
        if (le.v2 === dragId) le.v2 = targetId;
      });
      S.lockedEdges = S.lockedEdges.filter(le => le.v1 !== le.v2);
    }
  });

  deleteVertices(toDelete);
  S.selVtxs = [{ type: "topo", id: targetId }];
  toast(`${topos.length} vertices joined`, "ok");
  draw();
}

/**
 * Merge all selected parcels into one contiguous parcel (boundary-traced
 * ring), remapping vertices and dropping locked edges that vanished.
 *
 * @returns {void}
 */
export function combineParcels() {
  if (!S.topo || S.selParcels.length < 2) {
    toast("Select at least 2 parcels to combine", "er");
    return;
  }
  const sel = [...new Set(S.selParcels)].sort((a, b) => a - b);
  const selSet = new Set(sel);

  const dirCount = new Map();
  const undirected = new Map();
  sel.forEach((idx) => {
    const p = S.topo.parcels[idx];
    const n = p.vids.length;
    for (let k = 0; k < n; k++) {
      const a = p.vids[k];
      const b = p.vids[(k + 1) % n];
      dirCount.set(`${a}|${b}`, (dirCount.get(`${a}|${b}`) || 0) + 1);
      const uk = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!undirected.has(uk)) undirected.set(uk, { a, b });
    }
  });

  const boundary = [];
  undirected.forEach(({ a, b }) => {
    const total =
      (dirCount.get(`${a}|${b}`) || 0) + (dirCount.get(`${b}|${a}`) || 0);
    if (total === 1) boundary.push({ a, b });
  });

  if (boundary.length < 3) {
    toast("Cannot combine: no shared boundary found", "er");
    return;
  }

  const next = new Map();
  for (const { a, b } of boundary) {
    if (next.has(a)) {
      toast("Cannot combine: parcels touch at a point only", "er");
      return;
    }
    next.set(a, b);
  }

  const start = boundary[0].a;
  const ring = [start];
  let cur = next.get(start);
  while (cur !== start) {
    if (cur === undefined || ring.length > boundary.length) {
      toast("Cannot combine: selection must form one contiguous region", "er");
      return;
    }
    ring.push(cur);
    cur = next.get(cur);
  }
  if (ring.length !== boundary.length) {
    toast("Cannot combine: selection must form one contiguous region", "er");
    return;
  }

  const first = sel[0];
  const combined = {
    vids: ring,
    color: S.topo.parcels[first].color,
    label: S.topo.parcels[first].label,
  };
  const newParcels = [];
  S.topo.parcels.forEach((p, i) => {
    if (i === first) newParcels.push(combined);
    else if (!selSet.has(i)) newParcels.push(p);
  });

  const used = new Set();
  newParcels.forEach((p) => p.vids.forEach((v) => used.add(v)));
  const remap = new Map();
  const newVertices = [];
  S.topo.vertices.forEach((v, i) => {
    if (used.has(i)) {
      remap.set(i, newVertices.length);
      newVertices.push(v);
    }
  });
  newParcels.forEach((p) => {
    p.vids = p.vids.map((v) => remap.get(v));
  });

  const parcelEdges = new Set();
  newParcels.forEach((p) => {
    const n = p.vids.length;
    for (let k = 0; k < n; k++) {
      const a = p.vids[k];
      const b = p.vids[(k + 1) % n];
      parcelEdges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  });
  S.lockedEdges = (S.lockedEdges || [])
    .map((le) => ({ v1: remap.get(le.v1), v2: remap.get(le.v2) }))
    .filter(
      (le) =>
        le.v1 !== undefined &&
        le.v2 !== undefined &&
        parcelEdges.has(
          le.v1 < le.v2 ? `${le.v1}|${le.v2}` : `${le.v2}|${le.v1}`,
        ),
    );

  S.topo.vertices = newVertices;
  S.topo.parcels = newParcels;
  S.selParcels = [newParcels.indexOf(combined)];
  S.selVtxs = [];
  S.selEdges = [];

  const aDisp = pArea(combined) * S.measScale * S.measScale;
  logOk(
    `Combined ${sel.length} parcels → ${combined.label} (${aDisp.toFixed(1)} m²)`,
  );
  toast(`${sel.length} parcels combined`, "ok");
  draw();
}

/**
 * True when a topology edge is in the locked set (either direction).
 *
 * @param {{type: 'topo', v1: number, v2: number}} e
 * @returns {boolean}
 */
export function isLocked(e) {
  if (!S.lockedEdges) return false;
  return S.lockedEdges.some(le => (le.v1 === e.v1 && le.v2 === e.v2) || (le.v1 === e.v2 && le.v2 === e.v1));
}

/**
 * Lock/unlock the selected topology edges (toggle: all locked → unlock).
 *
 * @returns {void}
 */
export function toggleLock() {
  if (!S.selEdges) return;
  const topos = S.selEdges.filter(e => e.type === "topo");
  if (!topos.length) return;
  const allLocked = topos.every(e => isLocked(e));
  if (allLocked) {
    topos.forEach(e => {
      S.lockedEdges = S.lockedEdges.filter(le => !((le.v1 === e.v1 && le.v2 === e.v2) || (le.v1 === e.v2 && le.v2 === e.v1)));
    });
    toast("Edges unlocked", "ok");
  } else {
    topos.forEach(e => {
      if (!isLocked(e)) S.lockedEdges.push({ v1: e.v1, v2: e.v2 });
    });
    toast("Edges locked", "ok");
  }
  draw();
}

/**
 * Resolve an edge reference to its endpoint vertices/indices.
 *
 * @param {EdgeRef} ed
 * @returns {{A: Pt, B: Pt, v1?: number, v2?: number, i1?: number, i2?: number}}
 */
export function getEdgePts(ed) {
  if (ed.type === "topo")
    return {
      A: S.topo.vertices[ed.v1],
      B: S.topo.vertices[ed.v2],
      v1: ed.v1,
      v2: ed.v2,
    };
  else
    return {
      A: S.outerGeo[ed.i1],
      B: S.outerGeo[ed.i2],
      i1: ed.i1,
      i2: ed.i2,
    };
}

/**
 * Make the second selected edge parallel to the first (reference) edge,
 * sliding endpoints along their constraint lines (locks + adjacent
 * vertices). KNOWN v1 BUG preserved: the outer-edge branch references
 * out-of-scope `p1`/`p2` and throws a ReferenceError — see
 * gui/v2/KNOWN-ISSUES.md.
 *
 * @returns {void}
 */
export function makeParallel() {
  if (!S.selEdges || S.selEdges.length !== 2) return;
  const ref = getEdgePts(S.selEdges[0]);
  const tgt = getEdgePts(S.selEdges[1]);

  // Reference vector
  const rx = ref.B.x - ref.A.x,
    ry = ref.B.y - ref.A.y;

  if (S.selEdges[1].type === "topo") {
    let locks1 = 0, locks2 = 0;
    let line1_B = null, line2_B = null;
    if (S.lockedEdges) {
      const l1 = S.lockedEdges.filter(le => le.v1 === tgt.v1 || le.v2 === tgt.v1);
      locks1 = l1.length;
      if (locks1 === 1) line1_B = S.topo.vertices[l1[0].v1 === tgt.v1 ? l1[0].v2 : l1[0].v1];

      const l2 = S.lockedEdges.filter(le => le.v1 === tgt.v2 || le.v2 === tgt.v2);
      locks2 = l2.length;
      if (locks2 === 1) line2_B = S.topo.vertices[l2[0].v1 === tgt.v2 ? l2[0].v2 : l2[0].v1];
    }

    if (!line1_B) {
      const a1 = getAdjVertex(tgt.v1, tgt.v2);
      if (a1 !== null) line1_B = S.topo.vertices[a1];
    }
    if (!line2_B) {
      const a2 = getAdjVertex(tgt.v2, tgt.v1);
      if (a2 !== null) line2_B = S.topo.vertices[a2];
    }

    if (locks1 >= 2 && locks2 >= 2) {
      toast("Cannot make parallel: both endpoints are fully locked", "er");
      return;
    }

    let px = (tgt.A.x + tgt.B.x) / 2, py = (tgt.A.y + tgt.B.y) / 2;
    if (locks1 >= 2) { px = tgt.A.x; py = tgt.A.y; }
    else if (locks2 >= 2) { px = tgt.B.x; py = tgt.B.y; }

    const p1 = { x: px, y: py }, p2 = { x: px + rx, y: py + ry };

    if (locks1 < 2 && line1_B) {
      const inter = lineIntersection(p1, p2, tgt.A, line1_B);
      if (inter) {
        S.topo.vertices[tgt.v1].x = inter.x;
        S.topo.vertices[tgt.v1].y = inter.y;
      }
    }
    if (locks2 < 2 && line2_B) {
      const inter = lineIntersection(p1, p2, tgt.B, line2_B);
      if (inter) {
        S.topo.vertices[tgt.v2].x = inter.x;
        S.topo.vertices[tgt.v2].y = inter.y;
      }
    }
  } else {
    const len = S.outerGeo.length;
    const a1 = (tgt.i1 - 1 + len) % len;
    const a2 = (tgt.i2 + 1) % len;

    const vA = S.outerGeo[a1],
      vB = S.outerGeo[a2];
    const inter1 = lineIntersection(p1, p2, tgt.A, vA);
    if (inter1) {
      S.outerGeo[tgt.i1].x = inter1.x;
      S.outerGeo[tgt.i1].y = inter1.y;
    }

    const inter2 = lineIntersection(p1, p2, tgt.B, vB);
    if (inter2) {
      S.outerGeo[tgt.i2].x = inter2.x;
      S.outerGeo[tgt.i2].y = inter2.y;
    }
  }

  toast("Edge made parallel to reference", "ok");
  draw();
}

/**
 * Load a background image from a file input, prompt for its scale ratio
 * ("1:100" or a plain multiplier), rescale existing geometry accordingly
 * and center the image on the view. Notifies the sidebar via `bg`.
 *
 * @param {HTMLInputElement} input - File input (`accept="image/*"`).
 * @returns {void}
 */
export function loadBg(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      S.bgImage = img;
      S.bg = { x: 0, y: 0, scale: 1, rot: 0, opacity: 0.5 };

      let f = 1;
      const val = prompt(
        "Enter image scale ratio (e.g. 1:100 or 10):",
        "1:1",
      );
      if (val) {
        if (val.includes(":")) {
          const pts = val.split(":");
          const a = parseFloat(pts[0]);
          const b = parseFloat(pts[1]);
          if (!isNaN(a) && !isNaN(b) && a > 0) f = b / a;
        } else {
          f = parseFloat(val);
        }
        if (isNaN(f) || f <= 0) f = 1;
      }

      if (S.outerGeo)
        S.outerGeo.forEach((v) => {
          v.x *= f;
          v.y *= f;
        });
      if (S.drawPts)
        S.drawPts.forEach((v) => {
          v.x *= f;
          v.y *= f;
        });
      if (S.topo)
        S.topo.vertices.forEach((v) => {
          v.x *= f;
          v.y *= f;
        });

      S.pan.x *= f;
      S.pan.y *= f;
      S.zoom /= f;

      if (img.width > 0 && img.height > 0) {
        S.bg.scale = f;
        S.bg.x = S.pan.x;
        S.bg.y = S.pan.y;
      }

      emit("bg");
      draw();
      toast("Image loaded & geometry scaled by " + f, "ok");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Prompt for a measurement scale multiplier and apply it to all
 * displayed lengths/areas.
 *
 * @returns {void}
 */
export function editScale() {
  const val = prompt("Enter the scale multiplier (e.g. 1 or 2.5):", S.measScale.toFixed(4));
  if (val !== null) {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      S.measScale = num;
      emit("scale", { value: num });
      toast("Scale updated to " + num.toFixed(4), "ok");
      draw();
      notifyDrawStatus();
    }
  }
}

/**
 * Set one parcel's target share (in %) from a raw input value; empty or
 * non-positive clears the override. Live updates skip the full parcel
 * list rebuild (v1 `_origDraw` parity) but refresh target indicators.
 *
 * @param {number} i - Parcel index.
 * @param {string} val - Raw input value.
 * @param {boolean} live - True while the user types in the Tgt % field.
 * @returns {void}
 */
export function setTargetPct(i, val, live) {
  if (!S.topo) return;
  const v = parseFloat(val);
  if (isNaN(v) || v <= 0) delete S.targetPcts[i];
  else S.targetPcts[i] = v;
  drawCore();
  emit("targets");
  if (!live) emit("parcels");
}

/**
 * Center and zoom the view on all known geometry (topology vertices,
 * outer ring or in-progress points).
 *
 * @returns {void}
 */
export function fitView() {
  const pts = S.topo ? S.topo.vertices : S.outerGeo || S.drawPts;
  if (!pts || !pts.length) return;
  const xs = pts.map((v) => v.x || v[0]),
    ys = pts.map((v) => v.y || v[1]);
  const mnX = Math.min(...xs),
    mxX = Math.max(...xs);
  const mnY = Math.min(...ys),
    mxY = Math.max(...ys);
  S.pan = { x: (mnX + mxX) / 2, y: (mnY + mxY) / 2 };
  const cv = getCanvas();
  const sx = (cv.width * 0.75) / (mxX - mnX || 1);
  const sy = (cv.height * 0.75) / (mxY - mnY || 1);
  S.zoom = Math.min(sx, sy);
  emit("zoom");
  draw();
}

/**
 * Zoom by a multiplicative factor, clamped to [0.05, 2000].
 *
 * @param {number} f
 * @returns {void}
 */
export function doZoom(f) {
  S.zoom = Math.max(0.05, Math.min(2000, S.zoom * f));
  emit("zoom");
  draw();
}

/**
 * Toggle outer/per-parcel measurement overlays. v1 quirk preserved: the
 * outer toggles use `x === false ? true : false` (first click on an
 * unset flag yields false, not true).
 *
 * @param {'outer'|'pc'} type
 * @param {number|null} idx - Parcel index for `type === "pc"`.
 * @param {'len'|'ang'} kind
 * @returns {void}
 */
export function toggleMeas(type, idx, kind) {
  if (type === "outer") {
    if (kind === "len") S.showOuterLen = S.showOuterLen === false ? true : false;
    if (kind === "ang") S.showOuterAng = S.showOuterAng === false ? true : false;
  } else if (type === "pc") {
    if (kind === "len") S.showPcLen[idx] = !S.showPcLen[idx];
    if (kind === "ang") S.showPcAng[idx] = !S.showPcAng[idx];
  }
  draw();
}
