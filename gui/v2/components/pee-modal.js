/**
 * `<pee-modal>` — the "Paste custom GeoJSON" dialog. Listens on the
 * `modal` channel (`{open}`); the Load button hands the textarea
 * contents to {@link module:project.importGJ}, which reads `#paste-in`
 * directly (v1 parity).
 */

import { on } from "../js/events.js";
import { importGJ } from "../js/project.js";

class PeeModal extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `
      <div id="modal">
        <div class="mbox">
          <div class="mt">Paste custom GeoJSON</div>
          <div class="fr">
            <label
              ><code style="color: var(--accent)">{"outer":…,"parcels":[…]}</code>
              or FeatureCollection</label
            >
            <textarea
              id="paste-in"
              style="min-height: 190px; font-size: 10px"
              placeholder='{"outer":{"type":"Polygon","coordinates":[…]},"parcels":[…]}'
            ></textarea>
          </div>
          <div class="mf">
            <button class="btn btn-g" id="modal-cancel">Cancel</button>
            <button class="btn btn-p" id="modal-load">Load</button>
          </div>
        </div>
      </div>`;

    this.querySelector("#modal-cancel").addEventListener("click", () =>
      this.querySelector("#modal").classList.remove("open"),
    );
    this.querySelector("#modal-load").addEventListener("click", () =>
      importGJ(),
    );

    this._unsub = on("modal", ({ open }) => {
      this.querySelector("#modal").classList.toggle("open", open);
    });
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
  }
}

customElements.define("pee-modal", PeeModal);
