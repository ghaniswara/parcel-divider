/**
 * @module transform
 * World ↔ screen coordinate transforms for the main canvas.
 *
 * The canvas element is registered once by `<pee-canvas>` via
 * {@link initTransform}; the transforms themselves read the current view
 * (pan/zoom) from {@link module:state}.
 */

import { S } from "./state.js";

/** @type {HTMLCanvasElement|null} */
let canvas = null;

/**
 * Register the canvas used for world↔screen conversion. Called once by
 * `<pee-canvas>` after it renders its DOM.
 *
 * @param {HTMLCanvasElement} cv
 * @returns {void}
 */
export function initTransform(cv) {
  canvas = cv;
}

/**
 * Convert world coordinates to canvas (screen) pixel coordinates.
 * Y is flipped: world +Y points up on screen.
 *
 * @param {number} wx
 * @param {number} wy
 * @returns {[number, number]} `[sx, sy]` pixel coordinates.
 */
export function w2s(wx, wy) {
  return [
    canvas.width / 2 + (wx - S.pan.x) * S.zoom,
    canvas.height / 2 - (wy - S.pan.y) * S.zoom,
  ];
}

/**
 * Convert canvas (screen) pixel coordinates to world coordinates.
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {[number, number]} `[wx, wy]` world coordinates.
 */
export function s2w(sx, sy) {
  return [
    (sx - canvas.width / 2) / S.zoom + S.pan.x,
    -(sy - canvas.height / 2) / S.zoom + S.pan.y,
  ];
}
