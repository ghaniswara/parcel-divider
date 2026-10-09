/**
 * `<pee-app>` — application shell: the header/main grid plus the
 * fixed-position toast stack and modal. Children are created in
 * connected order so their `connectedCallback`s run header → sidebar →
 * canvas → panel (canvas registers itself with the renderer/transforms
 * before `main.js` boots the app).
 */

class PeeApp extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `
      <div id="app">
        <pee-header></pee-header>
        <div id="main">
          <pee-sidebar></pee-sidebar>
          <pee-canvas></pee-canvas>
          <pee-panel></pee-panel>
        </div>
      </div>
      <pee-toasts></pee-toasts>
      <pee-modal></pee-modal>`;
  }
}

customElements.define("pee-app", PeeApp);
