/**
 * @module main
 * Entry point for the v2 GUI: registers every custom element, mounts
 * `<pee-app>` and runs the v1 boot sequence.
 *
 * Boot order (v1 parity): `setTool("draw")` → `notifyDrawStatus()` →
 * set pan/zoom → `draw()`.
 */

import "../components/pee-header.js";
import "../components/pee-sidebar.js";
import "../components/pee-canvas.js";
import "../components/pee-panel.js";
import "../components/pee-modal.js";
import "../components/pee-toasts.js";
import "../components/pee-app.js";

import { S } from "./state.js";
import { draw } from "./render.js";
import { setTool } from "./actions.js";
import { notifyDrawStatus } from "./ui.js";

document.body.appendChild(document.createElement("pee-app"));

setTool("draw");
notifyDrawStatus();
S.pan = { x: 15, y: 8 };
S.zoom = 32;
draw();
