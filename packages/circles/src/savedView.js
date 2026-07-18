/**
 * saved cross-circle views.
 *
 * A **saved cross-circle view** is a named, persisted SET of audiences
 * (typically `circle-ref`s) plus a resolver that returns every item
 * visible to ANY of them.  In the audience continuum this is exactly a
 * `union` audience given a home: "a circle IS a saved audience", so a
 * *view over multiple circles* is a saved SET of circle-refs.
 *
 * ── Shape decision ──────────────────────────────────────────
 *
 * We reuse the canonical **`view` item type**
 * (`@onderling/item-types/src/types/view.js`) whose `audience` field is
 * defined precisely to hold "who sees this view" and accepts any
 * `Audience` — including a `{kind:'union', of:[…]}`.  A cross-circle
 * view is a `view` item whose `audience` is a union of circle-refs.
 *
 * Why NOT a "circle-of-circles" (a `circle` whose `members` are
 * circle-ids)?  A circle's `members` are **webids** — `resolveAudience`
 * treats `circle.members` as a concrete webid set.  Storing circle-ids
 * there is a type confusion: `resolveAudience` / `inAudience` would
 * treat the circle-ids as webids and resolve to the wrong member set.
 * The `view.audience = union(circle-refs)` form keeps circle-refs in a
 * field that is *typed* as `Audience`, so the existing
 * `resolveAudience` (which already handles `union` + `circle-ref`)
 * stays correct with zero new semantics.
 *
 * Why NOT a brand-new bespoke record?  The `view` type already exists,
 * already carries `title` / `itemType` / `filter` / `audience`, and was
 * introduced (V0) with saved-view resolution named as its
 * follow-up.  This slice is that follow-up; inventing a parallel record
 * would duplicate the model.
 *
 * These helpers are **pure** (no I/O of their own beyond the injected,
 * duck-typed `itemStore`).  They live in `@onderling/circles` because
 * normalisation (`circle:X` → `{kind:'circle-ref', id:'X'}`; `crew:` is
 * gone — only `circle:` is a recognised ref short-hand) is a
 * circles-layer concern that item-store deliberately can't depend on.
 */

import { normalizeAudience } from './audience.js';

/**
 * Extract the audience SET a saved view spans, in normalised form.
 *
 * A view's `audience` is normalised (so a `circle:X` short-hand becomes
 * `{kind:'circle-ref', id:'X'}` and unifies with the structured form),
 * then:
 *   - a top-level `{kind:'union', of:[…]}` flattens to its constituents
 *     (each already normalised by `normalizeAudience`);
 *   - any other single audience becomes a one-element set;
 *   - a missing / null audience yields the empty set `[]`.
 *
 * The result feeds `ListFilter.audiences` for a cross-circle query.
 *
 * @param {{ audience?: import('./audience.js').Audience }} view
 * @returns {import('./audience.js').Audience[]} normalised audience set
 */
export function savedViewAudiences(view) {
  const aud = view?.audience;
  if (aud === undefined || aud === null) return [];
  const n = normalizeAudience(aud);
  if (n.kind === 'union') return n.of;
  return [n];
}

/**
 * Build the `view` item partial for a saved cross-circle view.
 *
 * The `audiences` set is stored as the canonical `union` audience
 * (single-element sets collapse to that one audience).  Sets `text:
 * title` for `@onderling/item-store` substrate compatibility (mirrors the
 * `circle` store's workaround; substrate fix deferred).
 *
 * @param {object}   spec
 * @param {string}   spec.title
 * @param {string}   spec.itemType  the item type this view lists
 * @param {import('./audience.js').Audience[]} spec.audiences  circle-refs / audiences the view spans
 * @param {object}   [spec.filter]  extra `ListFilter` narrowing
 * @returns {object} a `view` item partial (pass to `itemStore.addItems`)
 */
export function makeSavedView({ title, itemType, audiences = [], filter } = {}) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('makeSavedView: title (non-empty string) required');
  }
  if (typeof itemType !== 'string' || itemType.trim() === '') {
    throw new TypeError('makeSavedView: itemType (non-empty string) required');
  }
  const set = audiences.map(normalizeAudience);
  const audience =
    set.length === 1 ? set[0] : { kind: 'union', of: set };
  return {
    type:     'view',
    text:     title,   // item-store substrate-compat (non-empty text)
    title,
    itemType,
    audience,
    ...(filter ? { filter: { ...filter } } : {}),
  };
}

/**
 * Resolve a saved cross-circle view to the UNIONED item list across its
 * circles — every item visible to ANY audience the view spans.
 *
 * Runs one cross-circle query: the view's audience set (via
 * {@link savedViewAudiences}) is handed to `ListFilter.audiences`, the
 * view's `itemType` becomes `filter.type`, and any `view.filter` is
 * merged underneath.  An empty audience set resolves to `[]` without
 * hitting the store.
 *
 * The `itemStore` is duck-typed: it needs `listOpen(filter)` (and
 * `listClosed(filter)` when `opts.closed` is set) — the same
 * `@onderling/item-store` surface the circles store already relies on.
 *
 * @param {{ audience?: import('./audience.js').Audience, itemType?: string, filter?: object }} view
 * @param {{ listOpen: Function, listClosed?: Function }} itemStore
 * @param {{ closed?: boolean }} [opts]  resolve closed items instead of open
 * @returns {Promise<object[]>} the unioned item list
 */
export async function resolveSavedView(view, itemStore, opts = {}) {
  if (!itemStore || typeof itemStore.listOpen !== 'function') {
    throw new TypeError('resolveSavedView: itemStore with listOpen(filter) required');
  }
  const audiences = savedViewAudiences(view);
  if (audiences.length === 0) return [];

  const filter = { ...(view?.filter ?? {}), audiences };
  if (typeof view?.itemType === 'string' && view.itemType !== '') {
    filter.type = view.itemType;
  }

  if (opts.closed) {
    if (typeof itemStore.listClosed !== 'function') {
      throw new TypeError('resolveSavedView: itemStore.listClosed required for { closed: true }');
    }
    return itemStore.listClosed(filter);
  }
  return itemStore.listOpen(filter);
}
