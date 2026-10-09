/**
 * @module api
 * Client for the PEE REST API: the `/equalize` optimization call and the
 * `/health` probe used by the header status dot.
 *
 * The equalize request is built exactly like v1's `runEq`: locked edges
 * become `movable_edges` with `movable: false`, custom target shares
 * become `target_areas`, iteration/tolerance come from the sidebar
 * inputs.
 */

import { S } from "./state.js";
import { getTargetAreas } from "./topology.js";
import { draw } from "./render.js";
import { toast, logOk, logR } from "./ui.js";
import { emit } from "./events.js";

/**
 * Default API base URL: same origin when the page is served over http(s)
 * (the normal case via `/v2`), otherwise v1's literal default.
 *
 * @returns {string}
 */
export function defaultApiUrl() {
  return location.protocol.startsWith("http")
    ? location.origin
    : "http://localhost:8000";
}

/**
 * POST the current topology to `/equalize` and apply the result. Shows a
 * spinner on the `#btn-eq` button, emits `stats`/`tab` for the panel and
 * logs/toasts the outcome.
 *
 * @returns {Promise<void>}
 */
export async function runEq() {
  if (!S.topo) {
    toast("Load or draw geometry first", "er");
    return;
  }
  const btn = document.getElementById("btn-eq");
  btn.disabled = true;
  btn.innerHTML = '<span class="sp2"></span> Running…';

  let ta = getTargetAreas();

  const url = document.getElementById("api-url").value.replace(/\/$/, "");

  let movable_edges = null;
  if (S.lockedEdges && S.lockedEdges.length > 0) {
    movable_edges = S.lockedEdges.map(le => ({
      v0: [S.topo.vertices[le.v1].x, S.topo.vertices[le.v1].y],
      v1: [S.topo.vertices[le.v2].x, S.topo.vertices[le.v2].y],
      movable: false
    }));
  }

  const payload = {
    geojson: {
      outer: {
        type: "Polygon",
        coordinates: [
          S.topo.outer
            .map((v) => [v.x, v.y])
            .concat([S.topo.outer.map((v) => [v.x, v.y])[0]]),
        ],
      },
      parcels: S.topo.parcels.map((p) => {
        const ring = p.vids.map((i) => [
          S.topo.vertices[i].x,
          S.topo.vertices[i].y,
        ]);
        ring.push(ring[0]);
        return { type: "Polygon", coordinates: [ring] };
      }),
    },
    all_interior_movable: S.allMovable,
    movable_edges: movable_edges,
    max_iter: +document.getElementById("max-iter").value || 200,
    tol: +document.getElementById("tol").value || 1e-8,
    target_areas: ta,
    validate_output: false,
  };

  const t0 = performance.now();
  try {
    const r = await fetch(`${url}/equalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.detail || r.statusText);
    }
    const res = await r.json();
    applyResult(res);
    emit("stats", { stats: res.stats });
    emit("tab", { name: "stats" });
    logOk(
      `✓ ${elapsed}s — ${res.stats.iterations} iters, max err ${res.stats.max_area_error_pct.toFixed(4)}%`,
    );
    toast("Equalized ✓", "ok");
    draw();
  } catch (e) {
    logR("Error: " + e.message);
    toast(e.message, "er");
  }
  done();

  /** @returns {void} */
  function done() {
    btn.disabled = false;
    btn.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg> Equalize';
  }
}

/**
 * Write optimized feature coordinates back into the topology vertices
 * (feature `i` maps onto parcel `i`, vertex order preserved).
 *
 * @param {{features: {geometry: {coordinates: number[][][]}}[]}} result
 * @returns {void}
 */
export function applyResult(result) {
  result.features.forEach((f, i) => {
    const ring = f.geometry.coordinates[0].slice(0, -1);
    const p = S.topo.parcels[i];
    ring.forEach(([x, y], k) => {
      const vid = p.vids[k];
      if (S.topo.vertices[vid]) {
        S.topo.vertices[vid].x = x;
        S.topo.vertices[vid].y = y;
      }
    });
  });
}

/**
 * Probe `<url>/health` with a 2s timeout. Never throws.
 *
 * @param {string} url - Base URL without trailing slash.
 * @returns {Promise<{ok: boolean, text: string}>} `"online" | "error" | "offline"`.
 */
export async function checkHealth(url) {
  try {
    const r = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { ok: r.ok, text: r.ok ? "online" : "error" };
  } catch {
    return { ok: false, text: "offline" };
  }
}
