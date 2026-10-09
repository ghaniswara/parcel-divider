# Known issues (ported from v1)

The v2 GUI is a 1:1 port of `gui/index.html`. Latent bugs below are
**preserved on purpose** so both UIs behave identically; fix them
deliberately in both places (or agree to diverge) later.

## Carried from v1 (behavior bugs)

1. **`makeParallel` throws on outer edges** — when the *second* selected
   edge is an outer edge, the outer branch references `p1`/`p2`, which are
   only in scope in the topo branch. Clicking ⏸ Parallel in that
   combination raises `ReferenceError: p1 is not defined` and the action
   is a no-op. (v1 ~lines 2095/2101; v2 `js/actions.js#makeParallel`.)

2. **`var(--t1)` / `var(--y)`-style custom properties are not all
   defined** — templates in `updatePcList`/`refreshTgtInfo` reference
   `var(--t1)`, which the stylesheet never defines, so those spans
   inherit the body text color instead. Cosmetic. (v1 `updatePcList`
   template; v2 `components/pee-panel.js`.)

3. **Outer measurement toggles use `x === false ? true : false`** — for
   an *unset* (undefined) flag the first click evaluates to `false`
   instead of toggling on. With the v1/v2 defaults (`false`) this is
   invisible; it only bites if a project file saves the flags as
   `undefined`. (v1 `toggleMeas`; v2 `js/actions.js#toggleMeas`.)

## Deliberate v2 deviations (net behavior unchanged)

- Dead v1 artifacts dropped: the unused `_lastDrawId` variable and the
  unused `geo` local in `runEq` (the payload builds `geojson`
  separately).
- `updatePcList`'s early-return when no geometry exists was dropped;
  v2 renders the "No parcels yet." empty state via the explicit
  `parcels` event instead of v1's manual innerHTML clears.
- Redundant `updatePcList()` calls immediately after `draw()` were
  dropped — the v2 `draw()` wrapper already notifies the parcel panel
  (that redundancy existed in v1's `window.draw` wrapper too).
- Default API URL: v1 hardcoded `http://localhost:8000`; v2 uses
  `location.origin` when served over http(s) (i.e. when opened via
  `/v2`), falling back to v1's literal otherwise.
- v1 inline `onclick="…"` handlers became `addEventListener` /
  `data-action` delegation inside the owning component (module functions
  are not globals). Event semantics preserved.
