/**
 * @module events
 * Minimal typed-ish publish/subscribe bus used for cross-component
 * communication in the v2 GUI.
 *
 * The UI is split into independent web components (light DOM custom
 * elements) plus plain logic modules. Logic modules never touch another
 * component's DOM: they `emit()` an event here and the component that owns
 * the affected DOM reacts.
 *
 * ## Channel reference
 *
 * | Channel        | Payload                          | Producer                  | Consumer        |
 * |----------------|----------------------------------|---------------------------|-----------------|
 * | `toast`        | `{message, type: 'ok'\|'er'}`    | ui helpers / any          | `<pee-toasts>`  |
 * | `log`          | `{html}`                         | ui helpers                | `<pee-panel>`   |
 * | `step`         | `{n}`                            | actions                   | `<pee-sidebar>` |
 * | `draw-status`  | none                             | actions                   | `<pee-sidebar>` |
 * | `split-ready`  | `{ready}`                        | actions                   | `<pee-sidebar>` |
 * | `hint`         | `{visible}`                      | actions                   | `<pee-canvas>`  |
 * | `selection`    | none                             | render / interactions     | sidebar + panel |
 * | `tool`         | `{tool}`                         | actions (`setTool`)       | sidebar + canvas |
 * | `parcels`      | none                             | render / actions          | `<pee-panel>`   |
 * | `targets`      | none                             | actions                   | `<pee-panel>`   |
 * | `totals`       | `{area, count}`                  | `<pee-panel>`             | `<pee-header>`  |
 * | `api`          | `{ok, text}`                     | api health poll           | `<pee-header>`  |
 * | `stats`        | `{stats}`                        | api                       | `<pee-panel>`   |
 * | `tab`          | `{name}`                         | api / panel               | `<pee-panel>`   |
 * | `zoom`         | none                             | actions                   | `<pee-canvas>`  |
 * | `scale`        | `{value}`                        | actions                   | `<pee-canvas>`  |
 * | `coords`       | `{text}`                         | interactions              | `<pee-canvas>`  |
 * | `bg`           | `{bg}`                           | actions                   | `<pee-sidebar>` |
 * | `modal`        | `{open}`                         | actions / project         | `<pee-modal>`   |
 * | `project-applied` | `{state}`                     | project apply             | sidebar/canvas  |
 */

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

/**
 * Subscribe to a bus channel.
 *
 * @param {string} event - Channel name (see module doc).
 * @param {Function} fn - Handler called with `(payload)` on emit.
 * @returns {() => void} Unsubscribe function.
 */
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

/**
 * Remove a previously-registered handler.
 *
 * @param {string} event - Channel name.
 * @param {Function} fn - Handler to remove.
 * @returns {void}
 */
export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

/**
 * Publish a payload on a channel. Handlers are invoked synchronously in
 * registration order. A throwing handler does not prevent the others from
 * running (errors are re-thrown after the loop... they are logged to the
 * console instead so one bad subscriber can't break a redraw).
 *
 * @param {string} event - Channel name.
 * @param {*} [payload] - Arbitrary payload forwarded to handlers.
 * @returns {void}
 */
export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[events] handler for "${event}" failed`, err);
    }
  }
}
