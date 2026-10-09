/**
 * @module project
 * Project persistence (save/load `.json`), GeoJSON import/export, PNG
 * snapshot export, and the paste-GeoJSON modal control.
 *
 * `applyProjectState` restores the full editor state and re-syncs every
 * affected component via the `project-applied`, `split-ready`, `hint`,
 * `scale`, `zoom`, `step` and `parcels` events (v1 did the same with
 * direct `getElementById` writes).
 */

import { S } from "./state.js";
import { buildTopo } from "./topology.js";
import { draw, getCanvas } from "./render.js";
import { setTool, fitView } from "./actions.js";
import { toast, logA, setStep, notifyDrawStatus } from "./ui.js";
import { emit } from "./events.js";

/** Project file schema version. @type {number} */
const PROJ_VERSION = 1;

/**
 * Serialize the current session (topology, view, toggles, settings,
 * background image as data URL) and download it as `map-project.json`.
 *
 * @returns {void}
 */
export function saveProject() {
  const proj = {
    app: "pee-project",
    version: PROJ_VERSION,
    savedAt: new Date().toISOString(),
    state: {
      topo: S.topo
        ? {
            vertices: S.topo.vertices.map((v) => ({ x: v.x, y: v.y })),
            parcels: S.topo.parcels.map((p) => ({
              vids: [...p.vids],
              color: p.color,
              label: p.label,
            })),
            outer: S.topo.outer.map((v) => ({ x: v.x, y: v.y })),
          }
        : null,
      outerGeo: S.outerGeo
        ? S.outerGeo.map((v) => ({ x: v.x, y: v.y }))
        : null,
      drawPts: S.drawPts.map((v) => ({ x: v.x, y: v.y })),
      drawDone: S.drawDone,
      measScale: S.measScale,
      lockedEdges: (S.lockedEdges || []).map((le) => ({
        v1: le.v1,
        v2: le.v2,
      })),
      bg: { ...S.bg },
      bgImage: S.bgImage ? S.bgImage.src : null,
      view: { zoom: S.zoom, pan: { ...S.pan } },
      tool: S.tool,
      toggles: {
        dragMode: S.dragMode,
        liveEq: S.liveEq,
        allMovable: S.allMovable,
        gridOpacity: S.gridOpacity,
        lblOpacity: S.lblOpacity,
        showOuterLen: S.showOuterLen,
        showOuterAng: S.showOuterAng,
      },
      showPcLen: { ...S.showPcLen },
      showPcAng: { ...S.showPcAng },
      targetPcts: { ...S.targetPcts },
      labelPos: { ...S.labelPos },
      settings: {
        apiUrl: document.getElementById("api-url").value,
        maxIter: document.getElementById("max-iter").value,
        tol: document.getElementById("tol").value,
        nRange: document.getElementById("n-range").value,
        splitDir: document.getElementById("split-dir").value,
      },
    },
  };
  const blob = new Blob([JSON.stringify(proj, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "map-project.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Project saved", "ok");
}

/**
 * Read a project file from a file input and apply it. Clears the input
 * value so the same file can be re-loaded.
 *
 * @param {HTMLInputElement} input - File input (`accept=".json"`).
 * @returns {void}
 */
export function loadProject(input) {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const proj = JSON.parse(e.target.result);
      if (proj.app !== "pee-project" || !proj.state) {
        toast("Not a valid project file", "er");
        return;
      }
      applyProjectState(proj.state);
    } catch (err) {
      toast("Load error: " + err.message, "er");
    }
  };
  reader.readAsText(file);
}

/**
 * Restore editor state from a parsed project `state` object and
 * re-sync all components.
 *
 * @param {Object} st - Parsed `proj.state`.
 * @returns {void}
 */
export function applyProjectState(st) {
  S.topo = st.topo || null;
  S.outerGeo = st.outerGeo || null;
  S.drawPts = st.drawPts || [];
  S.drawDone = !!st.drawDone;
  S.measScale = typeof st.measScale === "number" ? st.measScale : 1;
  S.lockedEdges = st.lockedEdges || [];
  S.bg = st.bg
    ? { ...st.bg }
    : { x: 0, y: 0, scale: 1, rot: 0, opacity: 0.5 };
  S.bgImage = null;
  if (st.bgImage) {
    const img = new Image();
    img.onload = function () {
      S.bgImage = img;
      draw();
    };
    img.src = st.bgImage;
  }
  if (st.view) {
    S.zoom = st.view.zoom || 40;
    S.pan = st.view.pan ? { ...st.view.pan } : { x: 15, y: 5 };
  }
  const tg = st.toggles || {};
  S.dragMode = tg.dragMode !== false;
  S.liveEq = !!tg.liveEq;
  S.allMovable = tg.allMovable !== false;
  S.gridOpacity =
    typeof tg.gridOpacity === "number" ? tg.gridOpacity : 1;
  S.lblOpacity =
    typeof tg.lblOpacity === "number" ? tg.lblOpacity : 0.8;
  S.labelPos = st.labelPos || {};
  S.showOuterLen = !!tg.showOuterLen;
  S.showOuterAng = !!tg.showOuterAng;
  S.showPcLen = st.showPcLen || {};
  S.showPcAng = st.showPcAng || {};
  S.targetPcts = st.targetPcts || {};
  S.selParcels = [];
  S.selVtxs = [];
  S.selEdges = [];

  emit("project-applied", { state: st });
  emit("scale", { value: S.measScale });

  const hasGeo = !!(S.outerGeo && S.outerGeo.length >= 3);
  emit("split-ready", { ready: hasGeo });
  emit("hint", { visible: !(S.topo || S.outerGeo) });
  if (S.topo) setStep(3);
  else if (S.outerGeo) setStep(2);
  else setStep(1);
  setTool(st.tool || "draw");
  emit("zoom");
  notifyDrawStatus();
  draw();
  emit("parcels");
  logA("Project loaded");
  toast("Project loaded", "ok");
}

/**
 * Build a new topology from pasted GeoJSON (`{"outer":…,"parcels":[…]}`
 * or a FeatureCollection), dividing coordinates by the current
 * measurement scale. Reads the textarea `#paste-in` (v1 parity).
 *
 * @returns {void}
 */
export function importGJ() {
  const raw = document.getElementById("paste-in").value.trim();
  if (!raw) {
    toast("Paste GeoJSON first", "er");
    return;
  }
  try {
    const geo = JSON.parse(raw);
    S.topo = buildTopo(geo);

    S.selParcels = [];
    S.showPcLen = {};
    S.showPcAng = {};
    S.targetPcts = {};
    const m = S.measScale || 1;
    S.topo.vertices.forEach(v => {
      v.x /= m;
      v.y /= m;
    });
    S.topo.outer.forEach(v => {
      v.x /= m;
      v.y /= m;
    });

    S.outerGeo = S.topo.outer;
    S.drawDone = false;
    S.drawPts = [];
    S.lockedEdges = [];
    emit("split-ready", { ready: true });
    emit("hint", { visible: false });
    closeModal();
    setStep(3);
    fitView();
    logA(`Custom GeoJSON: ${S.topo.parcels.length} parcels`);
    toast("GeoJSON loaded", "ok");
  } catch (e) {
    toast("Parse error: " + e.message, "er");
  }
}

/**
 * Download the current topology (scaled by the measurement scale) as
 * `parcels.geojson`.
 *
 * @returns {void}
 */
export function exportGJ() {
  if (!S.topo) {
    toast("Nothing to export", "er");
    return;
  }
  const m = S.measScale || 1;
  const outerRing = S.topo.outer.map((v) => [v.x * m, v.y * m]);
  outerRing.push(outerRing[0]);
  const geo = {
    outer: { type: "Polygon", coordinates: [outerRing] },
    parcels: S.topo.parcels.map((p) => {
      const ring = p.vids.map((i) => [
        S.topo.vertices[i].x * m,
        S.topo.vertices[i].y * m,
      ]);
      ring.push(ring[0]);
      return { type: "Polygon", coordinates: [ring] };
    }),
  };
  const blob = new Blob([JSON.stringify(geo, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "parcels.geojson";
  a.click();
  toast("Exported", "ok");
}

/**
 * Download the current canvas as `map_export.png`.
 *
 * @returns {void}
 */
export function exportImage() {
  const link = document.createElement("a");
  link.download = "map_export.png";
  link.href = getCanvas().toDataURL("image/png");
  link.click();
  toast("Image exported", "ok");
}

/**
 * Open the paste-GeoJSON modal.
 *
 * @returns {void}
 */
export function openModal() {
  emit("modal", { open: true });
}

/**
 * Close the paste-GeoJSON modal.
 *
 * @returns {void}
 */
export function closeModal() {
  emit("modal", { open: false });
}
