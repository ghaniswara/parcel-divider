/**
 * `<pee-canvas>` — center region: tool toolbar (pan/draw/draw-parcel/
 * edit-outer/select/edit-bg/calibrate), scale + zoom readouts, the main
 * `<canvas>`, the hint overlay and the cursor coordinate readout.
 *
 * Owns the render/transform/interaction bootstrap: binds the renderer
 * and world↔screen transforms to its canvas, attaches pointer/keyboard
 * handlers, and resizes the backing store on window resize.
 *
 * Subscribes to: `tool` (button highlight + cursor), `zoom` (label),
 * `scale` (label), `hint` (overlay opacity), `coords` (readout).
 */

import { on } from "../js/events.js";
import { S } from "../js/state.js";
import { initTransform } from "../js/transform.js";
import { init as initRender, draw } from "../js/render.js";
import { attach } from "../js/interactions.js";
import { setTool, doZoom, fitView, editScale } from "../js/actions.js";

/** Toolbar button → active-state class, v1 parity. */
const CLS = {
  pan: "",
  draw: "on-p",
  "draw-parcel": "on-p",
  select: "on",
  "edit-outer": "on-y",
  "edit-bg": "on",
  calibrate: "on-p",
};

/** Tool buttons in toolbar order. @type {[string, string][]} */
const TOOL_BUTTONS = [
  ["tool-pan", "pan"],
  ["tool-draw", "draw"],
  ["tool-draw-parcel", "draw-parcel"],
  ["tool-edit-outer", "edit-outer"],
  ["tool-select", "select"],
  ["tool-edit-bg", "edit-bg"],
  ["tool-calibrate", "calibrate"],
];

class PeeCanvas extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `
      <div id="cv-wrap">
        <div id="cv-bar">
          <button class="tb" id="tool-pan">✋ Pan</button>
          <button class="tb on-p" id="tool-draw">✏ Draw</button>
          <button class="tb" id="tool-draw-parcel">▭ Draw Parcel</button>
          <button class="tb" id="tool-edit-outer">⬠ Edit Polygon</button>
          <button class="tb" id="tool-select">⬡ Select Parcels</button>
          <button class="tb" id="tool-edit-bg">🖼 Edit Bg</button>
          <button class="tb" id="tool-calibrate">📏 Calibrate</button>
          <div style="flex: 1"></div>
          <span
            style="font-size: 11px; color: var(--accent); margin-right: 12px; cursor: pointer; text-decoration: underline"
            id="scale-lbl"
            title="Click to manually edit scale"
            >Scale: 1.0000x</span
          >
          <span style="font-size: 10px; color: var(--t3)" id="zoom-lbl"
            >100%</span
          >
          <button class="tb" id="zoom-in">+</button>
          <button class="tb" id="zoom-out">−</button>
          <button class="tb" id="zoom-fit">Fit</button>
        </div>
        <div id="cv-ctr">
          <canvas id="canvas" tabindex="1"></canvas>
          <div class="hint" id="hint">
            ✏ Draw your outer polygon — or load a Quick Example →
          </div>
          <div id="coords"></div>
        </div>
      </div>`;

    const canvas = this.querySelector("#canvas");
    const ctr = this.querySelector("#cv-ctr");

    initTransform(canvas);
    initRender(canvas);
    attach(canvas);

    const resize = () => {
      canvas.width = ctr.clientWidth;
      canvas.height = ctr.clientHeight;
      draw();
    };
    window.addEventListener("resize", resize);
    resize();
    // The window listener alone can miss size changes that happen
    // without a window resize (late-applied CSS, font swap, initial
    // layout settling) — observe the container directly as well.
    this._ro = new ResizeObserver(resize);
    this._ro.observe(ctr);

    for (const [id, tool] of TOOL_BUTTONS) {
      this.querySelector(`#${id}`).addEventListener("click", () =>
        setTool(tool),
      );
    }
    this.querySelector("#zoom-in").addEventListener("click", () => doZoom(1.2));
    this.querySelector("#zoom-out").addEventListener("click", () => doZoom(0.83));
    this.querySelector("#zoom-fit").addEventListener("click", () => fitView());
    this.querySelector("#scale-lbl").addEventListener("click", () => editScale());

    this._unsubs = [
      on("tool", ({ tool }) => {
        for (const [id, name] of TOOL_BUTTONS) {
          const b = this.querySelector(`#${id}`);
          if (!b) continue;
          b.classList.remove("on", "on-p", "on-g", "on-y");
          if (name === tool) b.classList.add(CLS[name] || "on");
        }
        canvas.style.cursor =
          tool === "draw" || tool === "draw-parcel" ? "crosshair" : "default";
      }),
      on("zoom", () => {
        this.querySelector("#zoom-lbl").textContent =
          `${Math.round(S.zoom * 100)}%`;
      }),
      on("scale", ({ value }) => {
        this.querySelector("#scale-lbl").textContent =
          "Scale: " + value.toFixed(4) + "x";
      }),
      on("hint", ({ visible }) => {
        this.querySelector("#hint").style.opacity = visible ? "1" : "0";
      }),
      on("coords", ({ text }) => {
        this.querySelector("#coords").textContent = text;
      }),
    ];
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
    (this._unsubs || []).forEach((u) => u());
    this._unsubs = [];
  }
}

customElements.define("pee-canvas", PeeCanvas);
