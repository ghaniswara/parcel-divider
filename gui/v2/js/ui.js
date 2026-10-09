/**
 * @module ui
 * User-feedback helpers shared by logic modules: transient toasts, the
 * log pane, and step-indicator updates.
 *
 * These never touch component DOM directly — they publish on the
 * {@link module:events} bus and the owning component renders the change.
 */

import { emit } from "./events.js";

/**
 * Escape a string for safe interpolation into innerHTML.
 *
 * @param {string} s
 * @returns {string} HTML-escaped text.
 */
export function xe(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Append a styled line to the log pane.
 *
 * @param {string} html - Pre-escaped HTML (already wrapped in a span by callers).
 * @returns {void}
 * @private
 */
function log(html) {
  emit("log", { html });
}

/**
 * Log a success (green) message.
 *
 * @param {string} m - Raw text (escaped here).
 * @returns {void}
 */
export function logOk(m) {
  log(`<span class="lok">${xe(m)}</span>`);
}

/**
 * Log an error (red) message.
 *
 * @param {string} m - Raw text (escaped here).
 * @returns {void}
 */
export function logR(m) {
  log(`<span class="lr">${xe(m)}</span>`);
}

/**
 * Log an informational (accent) message.
 *
 * @param {string} m - Raw text (escaped here).
 * @returns {void}
 */
export function logA(m) {
  log(`<span class="la">${xe(m)}</span>`);
}

/**
 * Show a transient toast notification.
 *
 * @param {string} msg - Raw text (escaped here).
 * @param {'ok'|'er'} [type] - Visual style; defaults to `"ok"`.
 * @returns {void}
 */
export function toast(msg, type = "ok") {
  emit("toast", { message: msg, type });
}

/**
 * Activate workflow step `n` (1 = Draw, 2 = Split, 3 = Equalize) on the
 * sidebar step indicator.
 *
 * @param {1|2|3} n
 * @returns {void}
 */
export function setStep(n) {
  emit("step", { n });
}

/**
 * Ask the sidebar to recompute the draw-status box from state. Emitted
 * whenever drawing progress changes (points added, polygon closed, …).
 *
 * @returns {void}
 */
export function notifyDrawStatus() {
  emit("draw-status");
}
