/**
 * D / SP-3b consumer-switch — thin selectors over renderWeb's PAGE
 * projection (`NavModel.pages[]`).
 *
 * Invariant #1 (logic lives once, in shared code): the NavModel is built
 * by the PURE `renderWeb` projector; page selection + label resolution
 * live here in shared `src/`, NOT hand-assembled inside a web DOM
 * renderer.  The web shell stays a thin adapter that just calls these
 * and drops the result into the DOM.
 *
 * Invariant #4 (the manifest is the source of truth for surfaces): a
 * running surface that reads a page's header label from here is a
 * genuine consumer of the manifest projection — the label flows
 * `manifest.surfaces.page.labelKey → renderWeb → pageLabel → t()`,
 * never a hardcoded string.
 */
import { renderWeb } from '@canopy/app-manifest';

/**
 * All top-level PAGE surfaces a manifest projects, in declaration order.
 * Empty array when the manifest declares no `surfaces.page` op (renderWeb
 * omits the `pages` key in that case — see renderWeb.js SP-3b).
 *
 * @param {object} manifest
 * @returns {Array<{opId: string, kind: string, title?: string, route?: string, labelKey?: string}>}
 */
export function manifestPages(manifest) {
  const nav = renderWeb(manifest);
  return Array.isArray(nav.pages) ? nav.pages : [];
}

/**
 * The projected `Page` for one op (the op that declares `surfaces.page`),
 * or `null` when the op doesn't declare a page surface.
 *
 * @param {object} manifest
 * @param {string} opId
 * @returns {object|null}
 */
export function pageForOp(manifest, opId) {
  return manifestPages(manifest).find((p) => p.opId === opId) ?? null;
}

/**
 * Localised header label for a projected `Page` (Q22 discipline):
 *   1. `page.labelKey` via `t()` when both are present (the manifest's
 *      localisation key — invariant #8);
 *   2. else the raw `page.title` passthrough (English fallback for
 *      consumers without a `t()`);
 *   3. else the caller-supplied `fallback` (graceful: a page-less /
 *      undefined surface keeps its bespoke label).
 *
 * @param {object|null|undefined} page
 * @param {Function|undefined} t
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
export function pageLabel(page, t, fallback) {
  if (page && typeof page.labelKey === 'string' && page.labelKey && typeof t === 'function') {
    return t(page.labelKey);
  }
  if (page && typeof page.title === 'string' && page.title) return page.title;
  return fallback;
}
