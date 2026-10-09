/**
 * `<pee-sidebar>` — left column: step indicator, draw status, subdivide
 * controls, equalize settings/toggles, geometry tools, background image
 * controls, quick examples, project save/load, import/export.
 *
 * DOM adapter: owns all sidebar DOM. Ported v1 logic it carries:
 * `updateDrawStatus`, `updateVtxTools`, `syncN`, `tog`, `syncTog`.
 * Subscribes to: `step`, `draw-status`, `split-ready`, `selection`,
 * `tool`, `bg`, `project-applied`.
 */

import { on } from "../js/events.js";
import { S } from "../js/state.js";
import { draw } from "../js/render.js";
import { polyArea } from "../js/math.js";
import {
  setTool,
  clearDraw,
  doSplit,
  resetAll,
  loadEx,
  deleteSelected,
  joinSelected,
  makeParallel,
  toggleLock,
  isLocked,
  loadBg,
} from "../js/actions.js";
import { runEq, defaultApiUrl } from "../js/api.js";
import {
  saveProject,
  loadProject,
  openModal,
  exportGJ,
  exportImage,
} from "../js/project.js";

class PeeSidebar extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    const apiDefault = defaultApiUrl();
    this.innerHTML = `
      <div id="sidebar">
        <!-- STEP INDICATOR -->
        <div class="sec" style="padding: 10px 14px">
          <div class="steps">
            <div class="step active" id="stp-1">① Draw</div>
            <div class="step" id="stp-2">② Split</div>
            <div class="step" id="stp-3">③ Equalize</div>
          </div>

          <!-- Draw status -->
          <div id="draw-status">
            <b>Click on the canvas to place polygon vertices.</b>
            Double-click or click the first point to close.
          </div>

          <div class="brow" style="margin-top: 8px">
            <button class="btn btn-draw active" id="btn-draw-tool">
              ✏ Draw polygon
            </button>
            <button class="btn btn-g" id="btn-clear-draw" disabled>
              ✕ Clear
            </button>
          </div>
        </div>

        <!-- SUBDIVIDE -->
        <div class="sec" id="sec-split">
          <div class="sh">
            ② Subdivide
            <span class="sh-badge" id="split-badge">needs polygon</span>
          </div>

          <div class="fr">
            <label>Number of lots (N)</label>
            <div class="slid-wrap">
              <input type="range" id="n-range" min="2" max="20" value="3" />
              <div class="slid-val" id="n-val">3</div>
              <input
                type="number"
                id="n-num"
                min="2"
                max="20"
                value="3"
                style="width: 52px"
              />
            </div>
          </div>

          <div class="fr">
            <label>Split direction</label>
            <select id="split-dir">
              <option value="auto">Auto (longest axis)</option>
              <option value="h">Horizontal strips</option>
              <option value="v">Vertical strips</option>
            </select>
          </div>

          <button class="btn btn-p" id="btn-split" disabled style="width: 100%">
            ⚡ Split into N lots
          </button>
        </div>

        <!-- EQUALIZE -->
        <div class="sec">
          <div class="sh">③ Equalize</div>

          <div class="tr">
            <label>Drag vertices &amp; edges</label>
            <div class="tog on" id="tog-drag"></div>
          </div>
          <div class="tr">
            <label>Auto-equalize on release</label>
            <div class="tog" id="tog-live"></div>
          </div>
          <div class="tr">
            <label>All interior edges movable</label>
            <div class="tog on" id="tog-all"></div>
          </div>

          <div class="fr">
            <label>API endpoint</label
            ><input id="api-url" value="${apiDefault}" />
          </div>
          <div class="fi2">
            <div class="fr">
              <label>Max iterations</label
              ><input id="max-iter" type="number" value="200" />
            </div>
            <div class="fr">
              <label>Tolerance</label><input id="tol" value="1e-8" />
            </div>
          </div>
          <div class="fr">
            <label>Target areas</label>
            <div style="font-size: 11px; color: var(--t2); line-height: 1.5">
              Set each parcel's target share with the <b>Tgt %</b> field in
              its card (Parcels tab). Unset parcels split the remainder
              equally.
            </div>
          </div>

          <div class="brow" style="margin-bottom: 7px">
            <button class="btn btn-p" id="btn-eq">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
              Equalize
            </button>
            <button class="btn btn-g" id="btn-reset">↺ Reset</button>
          </div>
        </div>

        <!-- GEOMETRY TOOLS -->
        <div class="sec">
          <div class="sh">
            Geometry Tools
            <span
              class="sh-badge"
              style="
                background: transparent;
                color: var(--t2);
                border: 1px solid var(--border);
              "
              >Shift+Click</span
            >
          </div>
          <div class="tr" style="margin-bottom: 4px">
            <label>Outer Lengths</label>
            <div class="tog" data-tog="showOuterLen"></div>
          </div>
          <div class="tr" style="margin-bottom: 8px">
            <label>Outer Angles</label>
            <div class="tog" data-tog="showOuterAng"></div>
          </div>
          <div class="fr">
            <label>Grid Opacity</label>
            <input id="grid-op" type="range" min="0" max="1" step="0.05" value="1" />
          </div>
          <div class="fr">
            <label>Label Opacity</label>
            <input id="lbl-op" type="range" min="0" max="1" step="0.05" value="0.8" />
          </div>
          <div class="fr">
            <label>Label Position</label>
            <div style="font-size: 11px; color: var(--t2); line-height: 1.5">
              Switch to <b>Pan</b> mode, hover a label until the cursor
              turns into a hand, then <b>drag</b> it anywhere. Works for
              the name/area label, edge lengths, and corner angles. Saved
              with the project.
            </div>
          </div>
          <div class="brow">
            <button class="btn btn-g" id="btn-join" disabled>🔗 Join</button>
            <button class="btn btn-g" id="btn-del" disabled>🗑 Delete</button>
            <button class="btn btn-g" id="btn-para" disabled>⏸ Parallel</button>
            <button class="btn btn-g" id="btn-lock" disabled>🔒 Lock</button>
          </div>
        </div>

        <!-- BACKGROUND IMAGE -->
        <div class="sec">
          <div class="sh">Background Image</div>
          <input type="file" id="bg-file" accept="image/*" style="display: none" />
          <button class="btn btn-g" id="btn-bg-load" style="width: 100%; margin-bottom: 8px">
            🖼 Load Image
          </button>

          <div id="bg-controls" style="display: none">
            <div class="fr">
              <label>Opacity</label
              ><input id="bg-op" type="range" min="0" max="1" step="0.05" value="0.5" />
            </div>

            <div class="fr">
              <label>Rotation (deg)</label
              ><input id="bg-rt" type="range" min="-180" max="180" step="1" value="0" />
            </div>
            <div class="fi2">
              <div class="fr">
                <label>X Offset</label
                ><input id="bg-x" type="number" value="0" step="5" />
              </div>
              <div class="fr">
                <label>Y Offset</label
                ><input id="bg-y" type="number" value="0" step="5" />
              </div>
            </div>
          </div>
        </div>

        <!-- QUICK EXAMPLES -->
        <div class="sec">
          <div class="sh">Quick examples</div>
          <div class="brow">
            <button class="btn btn-g" data-ex="3lot">3-lot</button>
            <button class="btn btn-g" data-ex="5lot">5-lot</button>
            <button class="btn btn-g" data-ex="lshape">L-shape</button>
            <button class="btn btn-g" data-ex="fan">Fan</button>
          </div>
        </div>

        <!-- PROJECT -->
        <div class="sec">
          <div class="sh">Project</div>
          <div class="brow">
            <button class="btn btn-p" id="btn-proj-save">💾 Save</button>
            <button class="btn btn-g" id="btn-proj-load">📂 Load</button>
            <input
              type="file"
              id="proj-file"
              accept=".json,application/json"
              style="display: none"
            />
          </div>
        </div>

        <!-- IMPORT / EXPORT -->
        <div class="sec">
          <div class="sh">Import / Export</div>
          <div class="brow">
            <button class="btn btn-g" id="btn-paste-gj">📋 Paste GeoJSON</button>
            <button class="btn btn-g" id="btn-export-gj">⬇ GeoJSON</button>
            <button class="btn btn-g" id="btn-export-img">🖼 Image</button>
          </div>
        </div>
      </div>`;

    this._wire();
    this._unsubs = [
      on("step", ({ n }) => this.renderStep(n)),
      on("draw-status", () => this.renderDrawStatus()),
      on("split-ready", ({ ready }) => this.renderSplitReady(ready)),
      on("selection", () => this.renderVtxTools()),
      on("tool", ({ tool }) => {
        const bd = this.querySelector("#btn-draw-tool");
        if (bd) bd.classList.toggle("active", tool === "draw");
      }),
      on("bg", () => this.renderBgControls()),
      on("project-applied", ({ state }) => this.renderProjectSync(state)),
    ];
  }

  disconnectedCallback() {
    (this._unsubs || []).forEach((u) => u());
    this._unsubs = [];
  }

  /** Attach all control listeners (v1 inline handlers, ported). @returns {void} */
  _wire() {
    const $ = (sel) => this.querySelector(sel);

    $("#btn-draw-tool").addEventListener("click", () => setTool("draw"));
    $("#btn-clear-draw").addEventListener("click", () => clearDraw());

    $("#n-range").addEventListener("input", (e) => this.syncN(e.target.value));
    $("#n-num").addEventListener("input", (e) => this.syncN(e.target.value));
    $("#btn-split").addEventListener("click", () => doSplit());

    $("#tog-drag").addEventListener("click", (e) =>
      this.tog(e.currentTarget, "dragMode"),
    );
    $("#tog-live").addEventListener("click", (e) =>
      this.tog(e.currentTarget, "liveEq"),
    );
    $("#tog-all").addEventListener("click", (e) =>
      this.tog(e.currentTarget, "allMovable"),
    );
    this.querySelectorAll("[data-tog]").forEach((el) =>
      el.addEventListener("click", () => this.tog(el, el.dataset.tog)),
    );

    $("#btn-eq").addEventListener("click", () => runEq());
    $("#btn-reset").addEventListener("click", () => resetAll());

    $("#grid-op").addEventListener("input", (e) => {
      S.gridOpacity = parseFloat(e.target.value);
      draw();
    });
    $("#lbl-op").addEventListener("input", (e) => {
      S.lblOpacity = parseFloat(e.target.value);
      draw();
    });

    $("#btn-join").addEventListener("click", () => joinSelected());
    $("#btn-del").addEventListener("click", () => deleteSelected());
    $("#btn-para").addEventListener("click", () => makeParallel());
    $("#btn-lock").addEventListener("click", () => toggleLock());

    const bgFile = $("#bg-file");
    $("#btn-bg-load").addEventListener("click", () => bgFile.click());
    bgFile.addEventListener("change", () => loadBg(bgFile));
    $("#bg-op").addEventListener("input", (e) => {
      S.bg.opacity = parseFloat(e.target.value);
      draw();
    });
    $("#bg-rt").addEventListener("input", (e) => {
      S.bg.rot = parseFloat(e.target.value);
      draw();
    });
    $("#bg-x").addEventListener("input", (e) => {
      S.bg.x = parseFloat(e.target.value) || 0;
      draw();
    });
    $("#bg-y").addEventListener("input", (e) => {
      S.bg.y = parseFloat(e.target.value) || 0;
      draw();
    });

    this.querySelectorAll("[data-ex]").forEach((b) =>
      b.addEventListener("click", () => loadEx(b.dataset.ex)),
    );

    $("#btn-proj-save").addEventListener("click", () => saveProject());
    const projFile = $("#proj-file");
    $("#btn-proj-load").addEventListener("click", () => projFile.click());
    projFile.addEventListener("change", () => loadProject(projFile));

    $("#btn-paste-gj").addEventListener("click", () => openModal());
    $("#btn-export-gj").addEventListener("click", () => exportGJ());
    $("#btn-export-img").addEventListener("click", () => exportImage());
  }

  /**
   * Highlight workflow steps 1–3 (v1 `setStep` DOM part).
   *
   * @param {1|2|3} n
   * @returns {void}
   */
  renderStep(n) {
    ["stp-1", "stp-2", "stp-3"].forEach((id, i) => {
      const el = this.querySelector(`#${id}`);
      el.classList.remove("active", "done");
      if (i + 1 < n) el.classList.add("done");
      else if (i + 1 === n) el.classList.add("active");
    });
  }

  /**
   * Recompute the draw-status box from state (v1 `updateDrawStatus`).
   *
   * @returns {void}
   */
  renderDrawStatus() {
    const el = this.querySelector("#draw-status");
    const bcl = this.querySelector("#btn-clear-draw");
    const n = S.drawPts.length;
    if (S.drawDone && S.outerGeo) {
      const aDisp = polyArea(S.outerGeo) * S.measScale * S.measScale;
      el.innerHTML = `<b>✓ Polygon ready</b> (${S.outerGeo.length} vertices, ${aDisp.toFixed(1)} m²)<br>Now set N and click <b>Split</b>.`;
      el.classList.add("done");
      bcl.disabled = false;
    } else if (n === 0) {
      el.innerHTML =
        "<b>Click on the canvas</b> to place polygon vertices. Double-click or click the first point to close.";
      el.classList.remove("done");
      bcl.disabled = true;
    } else if (n < 3) {
      el.innerHTML = `<b>${n} point${n > 1 ? "s" : ""} placed.</b> Keep clicking to add vertices (need ≥3).`;
      el.classList.remove("done");
      bcl.disabled = false;
    } else {
      el.innerHTML = `<b>${n} vertices.</b> Click the <span style="color:#3fb950">green start point</span> or double-click to close.`;
      el.classList.remove("done");
      bcl.disabled = false;
    }
  }

  /**
   * Sync the split button + badge with split-readiness.
   *
   * @param {boolean} ready
   * @returns {void}
   */
  renderSplitReady(ready) {
    this.querySelector("#btn-split").disabled = !ready;
    const badge = this.querySelector("#split-badge");
    badge.textContent = ready ? "ready ✓" : "needs polygon";
    badge.style.background = ready ? "var(--g)" : "";
  }

  /**
   * Sync the vertex/edge tool buttons from the current selection
   * (v1 `updateVtxTools` sidebar part, incl. the Lock/Unlock label).
   *
   * @returns {void}
   */
  renderVtxTools() {
    const bJ = this.querySelector("#btn-join");
    const bD = this.querySelector("#btn-del");
    const bP = this.querySelector("#btn-para");
    const bL = this.querySelector("#btn-lock");
    if (!bJ) return;
    const n = S.selVtxs ? S.selVtxs.length : 0;
    const numTopo = S.selVtxs
      ? S.selVtxs.filter((v) => v.type === "topo").length
      : 0;
    bJ.disabled = numTopo < 2;
    bD.disabled = n === 0;
    if (bP) bP.disabled = !S.selEdges || S.selEdges.length !== 2;
    if (bL) {
      const numTopoEdges = S.selEdges
        ? S.selEdges.filter((e) => e.type === "topo").length
        : 0;
      bL.disabled = numTopoEdges === 0;
      if (numTopoEdges > 0) {
        const allLocked = S.selEdges
          .filter((e) => e.type === "topo")
          .every((e) => isLocked(e));
        bL.innerHTML = allLocked ? "🔓 Unlock" : "🔒 Lock";
      } else {
        bL.innerHTML = "🔒 Lock";
      }
    }
  }

  /**
   * Sync background control inputs from `S.bg` (shown on image load,
   * updated during background drags).
   *
   * @returns {void}
   */
  renderBgControls() {
    this.querySelector("#bg-controls").style.display = "block";
    this.querySelector("#bg-op").value = S.bg.opacity;
    let r = S.bg.rot % 360;
    if (r > 180) r -= 360;
    if (r < -180) r += 360;
    this.querySelector("#bg-rt").value = r;
    this.querySelector("#bg-x").value = S.bg.x.toFixed(2);
    this.querySelector("#bg-y").value = S.bg.y.toFixed(2);
  }

  /**
   * Sync sidebar inputs from an applied project state (v1
   * `applyProjectState` sidebar DOM part).
   *
   * @param {Object} st - Parsed project state.
   * @returns {void}
   */
  renderProjectSync(st) {
    const $ = (sel) => this.querySelector(sel);
    const se = st.settings || {};
    if (se.apiUrl != null) $("#api-url").value = se.apiUrl;
    if (se.maxIter != null) $("#max-iter").value = se.maxIter;
    if (se.tol != null) $("#tol").value = se.tol;
    if (se.nRange != null) {
      $("#n-range").value = se.nRange;
      this.syncN(se.nRange);
    }
    if (se.splitDir != null) $("#split-dir").value = se.splitDir;
    $("#grid-op").value = S.gridOpacity;
    $("#lbl-op").value = S.lblOpacity;
    this.syncTog("#tog-drag", S.dragMode);
    this.syncTog("#tog-live", S.liveEq);
    this.syncTog("#tog-all", S.allMovable);
    if (st.bgImage) {
      $("#bg-controls").style.display = "block";
      $("#bg-op").value = S.bg.opacity;
      $("#bg-rt").value = S.bg.rot;
      $("#bg-x").value = S.bg.x;
      $("#bg-y").value = S.bg.y;
    } else {
      $("#bg-controls").style.display = "none";
    }
  }

  /**
   * Clamp + mirror the lot count across range/number inputs and the
   * value readout (v1 `syncN`).
   *
   * @param {string|number} v
   * @returns {void}
   */
  syncN(v) {
    v = Math.max(2, Math.min(20, parseInt(v) || 3));
    this.querySelector("#n-range").value = v;
    this.querySelector("#n-num").value = v;
    this.querySelector("#n-val").textContent = v;
  }

  /**
   * Toggle a boolean state flag from a `.tog` element and repaint
   * (v1 `tog`).
   *
   * @param {HTMLElement} el - The toggle element.
   * @param {keyof AppState} k - State flag name.
   * @returns {void}
   */
  tog(el, k) {
    el.classList.toggle("on");
    S[k] = el.classList.contains("on");
    draw();
  }

  /**
   * Set a toggle element's visual state without mutating state
   * (v1 `syncTog`).
   *
   * @param {string} sel - Selector within this element.
   * @param {boolean} onOff
   * @returns {void}
   */
  syncTog(sel, onOff) {
    const el = this.querySelector(sel);
    if (el) el.classList.toggle("on", !!onOff);
  }
}

customElements.define("pee-sidebar", PeeSidebar);
