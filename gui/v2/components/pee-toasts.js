/**
 * `<pee-toasts>` — fixed-position stack of transient toast notifications
 * (top-right). Listens on the `toast` channel; toasts auto-dismiss after
 * 3s with a fade.
 */

import { on } from "../js/events.js";
import { xe } from "../js/ui.js";

class PeeToasts extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `<div id="toasts"></div>`;

    this._unsub = on("toast", ({ message, type }) => {
      const w = this.querySelector("#toasts");
      const t = document.createElement("div");
      t.className = `toast ${type}`;
      const ic = type === "ok" ? "✓" : "✗";
      const col = type === "ok" ? "var(--g)" : "var(--r)";
      t.innerHTML = `<span style="color:${col};font-weight:700">${ic}</span> ${xe(message)}`;
      w.appendChild(t);
      setTimeout(() => {
        t.style.opacity = "0";
        t.style.transition = "opacity .3s";
        setTimeout(() => t.remove(), 300);
      }, 3000);
    });
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
  }
}

customElements.define("pee-toasts", PeeToasts);
