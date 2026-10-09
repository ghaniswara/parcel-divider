/**
 * `<pee-header>` — top bar: logo, title, version badge, API health
 * indicator and total area / lot count readouts.
 *
 * DOM adapter: subscribes to `totals` for the readouts and polls the API
 * health endpoint every 5s (v1 `checkAPI` parity). Reads the API URL from
 * the sidebar's `#api-url` input, falling back to the shared default.
 */

import { on } from "../js/events.js";
import { checkHealth, defaultApiUrl } from "../js/api.js";

class PeeHeader extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `
      <header>
        <div class="logo-i">PEE</div>
        <div class="logo-t">Parcel Equalization Engine</div>
        <div class="badge">v0.1</div>
        <div class="sp"></div>
        <div class="hs">
          <div class="dot" id="api-dot"></div>
          API <b id="api-st">–</b>
        </div>
        &nbsp;
        <div class="hs">Total <b id="hdr-a">–</b></div>
        &nbsp;
        <div class="hs">Lots <b id="hdr-n">–</b></div>
      </header>`;

    this._unsubs = [
      on("totals", ({ area, count }) => {
        this.querySelector("#hdr-a").textContent = area;
        this.querySelector("#hdr-n").textContent = count;
      }),
    ];

    this._poll = setInterval(() => this.check(), 5000);
    this.check();
  }

  disconnectedCallback() {
    clearInterval(this._poll);
    (this._unsubs || []).forEach((u) => u());
    this._unsubs = [];
  }

  /**
   * Probe the configured API once and update the status dot/text.
   *
   * @returns {Promise<void>}
   */
  async check() {
    const input = document.getElementById("api-url");
    const url = (input ? input.value : defaultApiUrl()).replace(/\/$/, "");
    const { ok, text } = await checkHealth(url);
    const dot = this.querySelector("#api-dot");
    const st = this.querySelector("#api-st");
    if (!dot || !st) return;
    dot.classList.toggle("on", ok);
    st.textContent = text;
  }
}

customElements.define("pee-header", PeeHeader);
