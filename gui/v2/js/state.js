/**
 * @module state
 * Shared, mutable application state for the v2 GUI (the `S` object) plus
 * the parcel color palette.
 *
 * The state shape is ported 1:1 from gui/index.html (v1). Modules import
 * `S` and mutate it in place exactly like v1 did; components read it to
 * render. There is deliberately no reactivity layer — `draw()` /
 * {@link module:events} events are the update mechanism.
 */

/**
 * A 2D world-space point.
 *
 * @typedef {Object} Pt
 * @property {number} x
 * @property {number} y
 */

/**
 * A parcel polygon in the topology, referencing vertices by index.
 *
 * @typedef {Object} Parcel
 * @property {number[]} vids - Indices into `Topo.vertices` (closed ring, first != last).
 * @property {string} color - CSS color for fills/strokes.
 * @property {string} label - Display name ("Lot 3", user-renameable).
 */

/**
 * Client-side topology: shared vertex array + parcel rings + outer boundary.
 *
 * @typedef {Object} Topo
 * @property {Pt[]} vertices - Deduplicated vertex list; parcels index into this.
 * @property {Parcel[]} parcels
 * @property {Pt[]} outer - Outer boundary ring (first != last).
 */

/**
 * Reference to a selectable vertex (either a topology vertex or an outer
 * polygon vertex).
 *
 * @typedef {Object} VtxRef
 * @property {'topo'|'outer'} type
 * @property {number} id - Vertex index in the respective array.
 */

/**
 * Reference to a selectable/draggable edge.
 *
 * @typedef {Object} EdgeRef
 * @property {'topo'|'outer'} type
 * @property {number} [v1] - Topo: first vertex index.
 * @property {number} [v2] - Topo: second vertex index.
 * @property {number} [i1] - Outer: first ring index.
 * @property {number} [i2] - Outer: second ring index.
 */

/**
 * Background image transform.
 *
 * @typedef {Object} BgTransform
 * @property {number} x - Center X (world units).
 * @property {number} y - Center Y (world units).
 * @property {number} scale - Image scale (world units per image pixel).
 * @property {number} rot - Rotation in degrees.
 * @property {number} opacity - 0..1.
 */

/**
 * Full application state. Field-by-field port of v1's `S`.
 *
 * @typedef {Object} AppState
 * @property {'draw'|'draw-parcel'|'pan'|'select'|'edit-outer'|'edit-bg'|'calibrate'} tool
 * @property {number} zoom - Pixels per world unit.
 * @property {Pt} pan - World coords at canvas center.
 * @property {Topo|null} topo - Built topology (null until a polygon exists).
 * @property {Pt[]|null} outerGeo - Outer polygon used for splitting.
 * @property {Pt[]} drawPts - Vertices placed during polygon drawing.
 * @property {Pt|null} mousePt - Current mouse position in world coords.
 * @property {boolean} drawDone - True once the outer polygon is closed.
 * @property {boolean} showOuterLen - Toggle: outer edge length labels.
 * @property {boolean} showOuterAng - Toggle: outer corner angle labels.
 * @property {Object<number, boolean>} showPcLen - Per-parcel length label toggles.
 * @property {Object<number, boolean>} showPcAng - Per-parcel angle label toggles.
 * @property {Object<number, number>} targetPcts - Per-parcel target share in %.
 * @property {number|null} hoveredParcelId
 * @property {VtxRef[]} selVtxs
 * @property {EdgeRef[]} selEdges
 * @property {VtxRef|null} dragVtx
 * @property {{wx: number, wy: number}|null} dragStartPos
 * @property {(VtxRef & {ox: number, oy: number})[]|null} selVtxsInit - Drag-start snapshot.
 * @property {VtxRef|null} hoverVtx
 * @property {(EdgeRef & {mx?: number, my?: number, ov1?: Pt, ov2?: Pt})|null} dragEdge
 * @property {EdgeRef|null} hoverEdge
 * @property {{sx: number, sy: number, px: number, py: number}|null} dragPan
 * @property {number[]} selParcels
 * @property {boolean} dragMode - Toggle: drag vertices & edges.
 * @property {boolean} liveEq - Toggle: auto-equalize on release.
 * @property {boolean} allMovable - Toggle: all interior edges movable.
 * @property {number} measScale - Measurement scale multiplier (m per world unit).
 * @property {{v1: number, v2: number}[]} lockedEdges - Topo edges pinned in place.
 * @property {number} gridOpacity
 * @property {number} lblOpacity
 * @property {Object<string, Pt>} labelPos - Manual label offsets keyed by label id.
 * @property {{key: string, x: number, y: number, w: number, h: number}[]} labelHits - Hitboxes rebuilt each draw.
 * @property {VtxRef & {sx?: number, sy?: number, ox?: number, oy?: number}|null} dragLbl
 * @property {HTMLImageElement|null} bgImage
 * @property {BgTransform} bg
 * @property {EdgeRef|null} dragBg
 * @property {{wx: number, wy: number, bgo: BgTransform}|null} dragBgStart
 */

/**
 * Parcel color palette, assigned round-robin when parcels are created.
 *
 * @type {string[]}
 */
export const COLORS = [
  "#58a6ff",
  "#3fb950",
  "#a371f7",
  "#f78166",
  "#d29922",
  "#56d364",
  "#79c0ff",
  "#ffa657",
  "#f2cc60",
  "#bc8cff",
];

/**
 * The global mutable state singleton.
 *
 * @type {AppState}
 */
export const S = {
  tool: "draw",
  zoom: 40,
  pan: { x: 15, y: 5 },
  // Topology
  topo: null,
  outerGeo: null, // [{x,y}] — outer polygon used for split
  // Drawing
  drawPts: [], // [{x,y}] placed points
  mousePt: null, // current mouse world pos
  drawDone: false, // polygon closed
  showOuterLen: false,
  showOuterAng: false,
  showPcLen: {},
  showPcAng: {},
  targetPcts: {},
  hoveredParcelId: null,
  // Drag / Select (Independent for outer vs topo)
  selVtxs: [], // array of {type:'topo'|'outer', id}
  selEdges: [], // array of edge objects
  dragVtx: null,
  dragStartPos: null,
  selVtxsInit: null,
  hoverVtx: null,
  dragEdge: null,
  hoverEdge: null,
  dragPan: null,
  selParcels: [],
  // Toggles
  dragMode: true,
  liveEq: false,
  allMovable: true,
  measScale: 1,
  lockedEdges: [],
  gridOpacity: 1.0,
  lblOpacity: 0.8,
  labelPos: {},
  labelHits: [],
  dragLbl: null,
  // Background
  bgImage: null,
  bg: { x: 0, y: 0, scale: 1, rot: 0, opacity: 0.5 },
  dragBg: null,
  dragBgStart: null,
};

/**
 * Default API base URL: same origin when the page is served over http(s)
 * (the normal case via `/v2`), otherwise v1's literal default.
 *
 * @returns {string}
 */
export function defaultApiUrl() {
  return location.protocol.startsWith("http")
    ? location.origin
    : "http://localhost:8000";
}

/**
 * Sidebar/global UI preferences that live outside the canvas state.
 * Kept here (not read from component DOM) because shadow roots are
 * closed to `document.getElementById` — the sidebar mirrors these into
 * its inputs, and `api`/`project`/`actions` read them from here.
 *
 * @typedef {Object} Prefs
 * @property {string} apiUrl - Equalize API base URL.
 * @property {string} maxIter - Raw input value (converted at use site).
 * @property {string} tol - Raw input value.
 * @property {string} nRange - Lot count (raw input value).
 * @property {string} splitDir - "auto" | "h" | "v".
 */

/**
 * Mutable UI preferences, mirrored by the sidebar inputs.
 *
 * @type {Prefs}
 */
export const prefs = {
  apiUrl: defaultApiUrl(),
  maxIter: "200",
  tol: "1e-8",
  nRange: "3",
  splitDir: "auto",
};
