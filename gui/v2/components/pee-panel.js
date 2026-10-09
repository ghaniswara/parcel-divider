/**
 * `<pee-panel>` — right column: tabbed Parcels / Stats / Log panes.
 *
 * DOM adapter carrying the ported v1 panel logic: `updatePcList` (parcel
 * cards + main-polygon card + totals), `hiPc`, `syncCombineUI`,
 * `updateStats`, `showTab`, `refreshTargets`, `refreshTgtInfo` and the
 * log pane. Card interactions (select, rename, per-card measurement
 * toggles, Tgt % inputs) are delegated via `data-*` attributes.
 *
 * Subscribes to: `parcels`, `targets`, `selection`, `stats`, `tab`,
 * `log`. Publishes `totals` for `<pee-header>`.
 */

import { on, emit } from "../js/events.js";
import { S } from "../js/state.js";
import { polyArea } from "../js/math.js";
import { pArea, totalArea, targetArea } from "../js/topology.js";
import { draw, drawCore } from "../js/render.js";
import {
  renameParcel,
  toggleMeas,
  setTargetPct,
  combineParcels,
} from "../js/actions.js";
import { xe } from "../js/ui.js";

class PeePanel extends HTMLElement {
  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this.innerHTML = `
      <div id="right">
        <div class="tabs">
          <div class="tab on" data-tab="parcels">Parcels</div>
          <div class="tab" data-tab="stats">Stats</div>
          <div class="tab" data-tab="log">Log</div>
        </div>
        <div class="tc on" id="tab-parcels">
          <div id="main-pc-info" style="margin-bottom: 8px"></div>
          <div
            id="tgt-info"
            style="
              display: none;
              background: var(--bg3);
              border: 1px solid var(--border);
              border-radius: var(--rad);
              padding: 7px 10px;
              margin-bottom: 8px;
            "
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: baseline;
              "
            >
              <span style="font-size: 10px; color: var(--t2)"
                >Target allocation</span
              >
              <span
                id="tgt-total"
                style="
                  font-family: 'JetBrains Mono', monospace;
                  font-size: 12px;
                  font-weight: 600;
                "
                >100.0%</span
              >
            </div>
            <div
              style="
                height: 4px;
                background: var(--bg);
                border-radius: 2px;
                margin-top: 5px;
                overflow: hidden;
              "
            >
              <div
                id="tgt-fill"
                style="
                  height: 100%;
                  width: 100%;
                  background: var(--g);
                  border-radius: 2px;
                  transition: width 0.3s ease, background 0.3s ease;
                "
              ></div>
            </div>
            <div
              id="tgt-msg"
              style="font-size: 10px; margin-top: 4px; color: var(--t2)"
            >
              Fully allocated
            </div>
          </div>
          <div
            id="pc-actions"
            style="
              display: none;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              background: var(--bg3);
              padding: 7px 10px;
              border-radius: var(--rad);
              border: 1px solid var(--border);
              margin-bottom: 8px;
            "
          >
            <span id="pc-sel-count" style="font-size: 10px; color: var(--t2)"
              >Shift+click parcels to multi-select</span
            >
            <button
              class="btn btn-p"
              id="btn-combine"
              disabled
              style="padding: 4px 10px; font-size: 11px"
              >⧉ Combine</button
            >
          </div>
          <div id="pc-list">
            <p style="color: var(--t3); font-size: 11px">No parcels yet.</p>
          </div>
        </div>
        <div class="tc" id="tab-stats">
          <div class="sg">
            <div class="sc">
              <div class="sl">Status</div>
              <div class="sv" id="st-ok">–</div>
            </div>
            <div class="sc">
              <div class="sl">Iters</div>
              <div class="sv a" id="st-it">–</div>
            </div>
            <div class="sc">
              <div class="sl">Max Err %</div>
              <div class="sv" id="st-er">–</div>
            </div>
            <div class="sc">
              <div class="sl">Parcels</div>
              <div class="sv a" id="st-n">–</div>
            </div>
          </div>
        </div>
        <div
          class="tc"
          id="tab-log"
          style="padding: 0; flex: 1; overflow: hidden"
        >
          <div
            id="log"
            style="
              height: 100%;
              max-height: none;
              border: none;
              border-radius: 0;
            "
          >
            Parcel Equalization Engine ready. Tip: ✏ Draw a polygon → ⚡ Split
            → ⬡ drag vertices/edges → ▶ Equalize Hold Shift or Alt while
            dragging to bypass snapping. Select a vertex and press Delete to
            remove it.
          </div>
        </div>
      </div>`;

    this._wire();
    this._unsubs = [
      on("parcels", () => this.updatePcList()),
      on("targets", () => this.refreshTargets()),
      on("selection", () => this.syncCombineUI()),
      on("stats", ({ stats }) => this.updateStats(stats)),
      on("tab", ({ name }) => this.showTab(name)),
      on("log", ({ html }) => {
        const l = this.querySelector("#log");
        l.innerHTML += html + "\n";
        l.scrollTop = l.scrollHeight;
      }),
    ];
  }

  disconnectedCallback() {
    (this._unsubs || []).forEach((u) => u());
    this._unsubs = [];
  }

  /** Attach tab clicks, combine button and card event delegation. @returns {void} */
  _wire() {
    this.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => this.showTab(t.dataset.tab)),
    );
    this.querySelector("#btn-combine").addEventListener("click", () =>
      combineParcels(),
    );

    this.addEventListener("click", (ev) => {
      const input = ev.target.closest("input");
      if (input) return; // v1: input events stopPropagation'd
      const act = ev.target.closest("[data-action]");
      if (act) {
        const i = act.dataset.idx !== undefined ? +act.dataset.idx : null;
        switch (act.dataset.action) {
          case "rename":
            renameParcel(i);
            return;
          case "pc-len":
            toggleMeas("pc", i, "len");
            return;
          case "pc-ang":
            toggleMeas("pc", i, "ang");
            return;
          case "outer-len":
            toggleMeas("outer", null, "len");
            return;
          case "outer-ang":
            toggleMeas("outer", null, "ang");
            return;
        }
      }
      const card = ev.target.closest(".pc");
      if (card) {
        const i = +card.dataset.idx;
        const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
        if (additive) {
          const k = S.selParcels.indexOf(i);
          if (k >= 0) S.selParcels.splice(k, 1);
          else S.selParcels.push(i);
        } else {
          S.selParcels = [i];
        }
        draw();
        this.hiPc();
      }
    });

    this.addEventListener("dblclick", (ev) => {
      const name = ev.target.closest("[data-rename]");
      if (name) renameParcel(+name.dataset.rename);
    });

    this.addEventListener("input", (ev) => {
      const pct = ev.target.closest("[data-pct]");
      if (pct) setTargetPct(+pct.dataset.pct, pct.value, true);
    });

    this.addEventListener("mouseover", (ev) => {
      const card = ev.target.closest(".pc");
      if (!card || card.contains(ev.relatedTarget)) return;
      const i = +card.dataset.idx;
      if (S.hoveredParcelId !== i) {
        S.hoveredParcelId = i;
        drawCore();
      }
    });

    this.addEventListener("mouseout", (ev) => {
      const card = ev.target.closest(".pc");
      if (!card || card.contains(ev.relatedTarget)) return;
      if (S.hoveredParcelId === +card.dataset.idx) {
        S.hoveredParcelId = null;
        drawCore();
      }
    });
  }

  /**
   * (Re)build the parcel list: main-polygon card, per-parcel cards with
   * target/measure controls, totals. Ported from v1 `updatePcList`;
   * v1's early-return when no geometry was dropped — the empty state is
   * rendered instead (see KNOWN-ISSUES).
   *
   * @returns {void}
   */
  updatePcList() {
    const mainDiv = this.querySelector("#main-pc-info");
    if (mainDiv) {
      if (S.outerGeo) {
        const a = polyArea(S.outerGeo) * S.measScale * S.measScale;
        const showLen = S.showOuterLen !== false;
        const showAng = S.showOuterAng !== false;
        mainDiv.innerHTML = `<div style="background:var(--bg3); padding:10px; border-radius:6px; font-size:12px; border:1px solid var(--border);">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--accent); font-size: 13px;">Main Polygon</strong>
                <div>
                  <span data-action="outer-len" style="cursor:pointer; font-size: 13px; margin-right: 4px; opacity: ${showLen ? 1 : 0.3}" title="Toggle Lengths">📏</span>
                  <span data-action="outer-ang" style="cursor:pointer; font-size: 13px; opacity: ${showAng ? 1 : 0.3}" title="Toggle Angles">📐</span>
                </div>
              </div>
              <div style="margin-top: 6px;">Area: <span style="color:var(--t1)">${a.toFixed(2)} m²</span></div>
              <div style="margin-top: 3px;">Vertices: <span style="color:var(--t1)">${S.outerGeo.length}</span></div>
            </div>`;
      } else {
        mainDiv.innerHTML = "";
      }
    }

    const div = this.querySelector("#pc-list");
    if (!S.topo) {
      div.innerHTML =
        '<p style="color:var(--t3);font-size:11px">No parcels yet.</p>';
      emit("totals", { area: "–", count: "–" });
      this.syncCombineUI();
      return;
    }

    const tot = totalArea();
    const totDisp = tot * S.measScale * S.measScale;
    div.innerHTML = "";
    emit("totals", {
      area: `${totDisp.toFixed(1)} m²`,
      count: S.topo.parcels.length,
    });
    S.topo.parcels.forEach((p, i) => {
      const ta = targetArea(i);
      const a = pArea(p);
      const taDisp = ta * S.measScale * S.measScale;
      const aDisp = a * S.measScale * S.measScale;
      const curPct = tot > 0 ? (ta / tot) * 100 : 0;
      const ep = ta > 0 ? ((a - ta) / ta) * 100 : 0;
      const abs = Math.abs(ep);
      const ec = abs < 0.1 ? "eg" : abs < 2 ? "ew" : "eb";
      const bar = Math.min(100, (a / (tot / S.topo.parcels.length)) * 50);
      const sel = S.selParcels.includes(i);
      const showPLen = !!S.showPcLen[i];
      const showPAng = !!S.showPcAng[i];
      const el = document.createElement("div");
      el.className = `pc${sel ? " sel" : ""}`;
      el.dataset.idx = i;
      el.innerHTML = `<div class="pch" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
  <div style="display:flex; align-items:center; min-width:0; flex:1;">
    <div class="pcd" style="background:${p.color}"></div>
    <div class="pcn" data-rename="${i}" style="cursor:text; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Double-click to rename">${xe(p.label)}</div>
  </div>
  <div>
    <span data-action="rename" data-idx="${i}" style="cursor:pointer; font-size: 12px; margin-right: 4px; opacity: 0.55" title="Rename parcel">✎</span>
    <span data-action="pc-len" data-idx="${i}" style="cursor:pointer; font-size: 13px; margin-right: 4px; opacity: ${showPLen ? 1 : 0.3}" title="Toggle lengths">📏</span>
    <span data-action="pc-ang" data-idx="${i}" style="cursor:pointer; font-size: 13px; opacity: ${showPAng ? 1 : 0.3}" title="Toggle angles">📐</span>
  </div>
</div>
<div class="pca">${aDisp.toFixed(2)} m² <span style="color:var(--t3)">→ <span id="pc-ta-${i}">${taDisp.toFixed(1)}</span></span></div>
<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
  <span style="font-size:10px;color:var(--t2);">Tgt %</span>
  <input id="pc-pct-${i}" data-pct="${i}" type="number" min="0" step="0.5" value="${curPct.toFixed(1)}"
    style="flex:1;min-width:0;background:var(--bg3);border:1px solid var(--border);color:var(--t1);border-radius:4px;padding:2px 5px;font-size:11px;font-family:'JetBrains Mono',monospace;" />
</div>
<div class="pce ${ec}" id="pc-ep-${i}">${ep >= 0 ? "+" : ""}${ep.toFixed(2)}%</div>
<div class="pb"><div class="pf" id="pc-bar-${i}" style="width:${bar}%;background:${p.color}"></div></div>`;
      div.appendChild(el);
    });
    this.refreshTgtInfo();
    this.syncCombineUI();
  }

  /**
   * Toggle the `.sel` class on parcel cards from `S.selParcels`
   * (v1 `hiPc`).
   *
   * @returns {void}
   */
  hiPc() {
    this.querySelectorAll(".pc").forEach((el) =>
      el.classList.toggle("sel", S.selParcels.includes(+el.dataset.idx)),
    );
    this.syncCombineUI();
  }

  /**
   * Show/hide the multi-select action bar and sync its count + combine
   * button (v1 `syncCombineUI`).
   *
   * @returns {void}
   */
  syncCombineUI() {
    const bar = this.querySelector("#pc-actions");
    if (!bar) return;
    if (!S.topo) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    const n = S.selParcels.length;
    const cnt = this.querySelector("#pc-sel-count");
    if (cnt)
      cnt.textContent = n
        ? `${n} parcel${n > 1 ? "s" : ""} selected`
        : "Shift+click parcels to multi-select";
    const btn = this.querySelector("#btn-combine");
    if (btn) btn.disabled = n < 2;
  }

  /**
   * Partial in-place refresh of per-card target/error/bar indicators
   * (v1 `refreshTargets`) — used while typing in a Tgt % field.
   *
   * @returns {void}
   */
  refreshTargets() {
    if (!S.topo) return;
    const tot = totalArea();
    const n = S.topo.parcels.length;
    S.topo.parcels.forEach((p, i) => {
      const ta = targetArea(i);
      const a = pArea(p);
      const taDisp = ta * S.measScale * S.measScale;
      const ep = ta > 0 ? ((a - ta) / ta) * 100 : 0;
      const abs = Math.abs(ep);
      const ec = abs < 0.1 ? "eg" : abs < 2 ? "ew" : "eb";
      const bar = Math.min(100, (a / (tot / n)) * 50);
      const taEl = this.querySelector(`#pc-ta-${i}`);
      if (taEl) taEl.textContent = taDisp.toFixed(1);
      const epEl = this.querySelector(`#pc-ep-${i}`);
      if (epEl) {
        epEl.className = `pce ${ec}`;
        epEl.textContent = `${ep >= 0 ? "+" : ""}${ep.toFixed(2)}%`;
      }
      const barEl = this.querySelector(`#pc-bar-${i}`);
      if (barEl) barEl.style.width = `${bar}%`;
    });
    this.refreshTgtInfo();
  }

  /**
   * Sync the target-allocation summary bar + message (v1
   * `refreshTgtInfo`).
   *
   * @returns {void}
   */
  refreshTgtInfo() {
    const panel = this.querySelector("#tgt-info");
    if (!panel) return;
    if (!S.topo) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    const n = S.topo.parcels.length;
    let assigned = 0;
    for (let i = 0; i < n; i++) {
      const v = S.targetPcts[i];
      assigned += v != null && !isNaN(v) && v > 0 ? v : 100 / n;
    }
    const remaining = 100 - assigned;
    const over = remaining < -0.05;
    const totEl = this.querySelector("#tgt-total");
    const fill = this.querySelector("#tgt-fill");
    const msg = this.querySelector("#tgt-msg");
    if (totEl) totEl.textContent = `${assigned.toFixed(1)}%`;
    if (fill) {
      fill.style.width = `${Math.max(0, Math.min(100, assigned))}%`;
      fill.style.background = over ? "var(--r)" : "var(--g)";
    }
    if (totEl) totEl.style.color = over ? "var(--r)" : "var(--t1)";
    if (msg) {
      if (over) {
        msg.style.color = "var(--r)";
        msg.textContent = `${Math.abs(remaining).toFixed(1)}% over-allocated — you assigned more than the available land area`;
      } else if (remaining > 0.05) {
        msg.style.color = "var(--y)";
        msg.textContent = `${remaining.toFixed(1)}% remaining — unassigned land`;
      } else {
        msg.style.color = "var(--t2)";
        msg.textContent = "Fully allocated";
      }
    }
  }

  /**
   * Fill the stats tab from an equalize result (v1 `updateStats`).
   *
   * @param {{success: boolean, iterations: number, max_area_error_pct: number}} s
   * @returns {void}
   */
  updateStats(s) {
    const ep = s.max_area_error_pct;
    const okEl = this.querySelector("#st-ok");
    okEl.textContent = s.success ? "✓ OK" : "✗ FAIL";
    okEl.className = `sv ${s.success ? "g" : "r"}`;
    this.querySelector("#st-it").textContent = s.iterations;
    const erEl = this.querySelector("#st-er");
    erEl.textContent = `${ep.toFixed(4)}%`;
    erEl.className = `sv ${ep < 0.1 ? "g" : ep < 0.5 ? "" : "r"}`;
    this.querySelector("#st-n").textContent = S.topo?.parcels.length || "–";
  }

  /**
   * Switch the visible tab (v1 `showTab`).
   *
   * @param {'parcels'|'stats'|'log'} n
   * @returns {void}
   */
  showTab(n) {
    const ns = ["parcels", "stats", "log"];
    this.querySelectorAll(".tab").forEach((t, i) =>
      t.classList.toggle("on", ns[i] === n),
    );
    this.querySelectorAll(".tc").forEach((t) => t.classList.remove("on"));
    this.querySelector(`#tab-${n}`)?.classList.add("on");
  }
}

customElements.define("pee-panel", PeePanel);
