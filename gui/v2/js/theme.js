/**
 * @module theme
 * Loads `css/pee.css` once and exposes it as a shared `CSSStyleSheet`
 * that every component adopts into its shadow root via
 * `adoptedStyleSheets` — one theme file to maintain, real per-component
 * style encapsulation, no build step.
 *
 * `main.js` awaits {@link themeReady} before mounting the app, so
 * components never render unstyled. If the fetch fails the app still
 * boots (unstyled) and logs the error.
 */

const url = new URL("../css/pee.css", import.meta.url);

/** @type {CSSStyleSheet|null} */
let baseSheet = null;
/** @type {Map<string, CSSStyleSheet>} */
const hostSheets = new Map();

/**
 * Resolves once the shared stylesheet has been fetched and parsed.
 *
 * @type {Promise<void>}
 */
export const themeReady = (async () => {
  const css = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text();
  });
  baseSheet = new CSSStyleSheet();
  baseSheet.replaceSync(css);
})().catch((err) => {
  console.error("[theme] failed to load stylesheet", err);
});

/**
 * The adopted-stylesheets list for a shadow root: the shared theme plus
 * (optionally) a cached per-component sheet for `:host` rules.
 *
 * @param {string} [hostCss] - Extra CSS scoped to the component's own
 *   root (typically `:host { display: block; }`).
 * @returns {CSSStyleSheet[]} Empty until {@link themeReady} resolves.
 */
export function getThemeSheets(hostCss = "") {
  if (!baseSheet) return [];
  if (!hostCss) return [baseSheet];
  if (!hostSheets.has(hostCss)) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(hostCss);
    hostSheets.set(hostCss, sheet);
  }
  return [baseSheet, hostSheets.get(hostCss)];
}
