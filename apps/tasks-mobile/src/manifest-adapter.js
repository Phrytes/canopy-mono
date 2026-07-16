/**
 * tasks-mobile — NavModel adapter (Slice C.1, 2026-05-20).
 *
 * Thin platform-neutral wrapper over a manifest's NavModel + the
 * shared web-adapter helpers.  Same logic feeds the web shells in
 * `apps/tasks-v0/web/*.html` today (via the .js helpers imported
 * inline); this file lifts that logic into a single, RN-friendly
 * factory so React Navigation screens consume the manifest the same
 * way the HTML pages do.
 *
 * Cross-surface parity — this file is INTENTIONALLY platform-
 * neutral.  No React, no React Native, no DOM.  A future cleanup
 * (V0.4 of the PLAN-gui-chat-uplift sweep) can lift it verbatim to
 * `@onderling/manifest-adapter` so web + mobile + chat all share one
 * source.  For V0.3 / Slice C.1 it ships in tasks-mobile to keep
 * the radius tight; the shape is deliberately framework-free so
 * the lift is a copy + rewire of consumers, no API churn.
 *
 *   import { createNavModelAdapter } from './manifest-adapter.js';
 *   import { tasksManifest }         from '@onderling-app/tasks-v0/manifest';
 *
 *   const adapter = createNavModelAdapter(tasksManifest, { callSkill });
 *   const open    = adapter.getSection('open');
 *   const reply   = await adapter.fetchSection(open);
 *   const items   = Array.isArray(reply?.items) ? reply.items : [];
 *   for (const it of items) {
 *     const actions = adapter.renderItemActions(open, it);  // state-gated
 *   }
 *
 * Discipline (mirrors `apps/tasks-v0/web/mine.html` patterns):
 *   - `getSection(id)` returns the projected NavModel section, or
 *     `undefined` when the manifest doesn't declare it.  Callers
 *     decide whether a missing section is a bug or a soft no-op
 *     (the web shells fall back to an empty array).
 *   - `fetchSection(section)` honours the V0.2 Q7 `dataSource` field
 *     via `fetchSectionItems` from `@onderling/web-adapter`.  The reply
 *     shape is verbatim (different list-skills return different
 *     payload shapes — `{items}`, `{tasks}`, etc.); the caller
 *     extracts per app convention.
 *   - `renderItemActions(section, item)` returns the section's
 *     `itemActions[]` filtered by the manifest's `appliesTo` gate
 *     (`itemMatchesAppliesTo`) and decorated with `prefilledParams`
 *     applied (via `applyPrefilledParams`) so the screen can fire
 *     `callSkill(action.opId, action.args)` directly.
 *
 * What this adapter does NOT do (by design):
 *   - No RN rendering (the screen owns Pressable / FlatList / styling).
 *   - No skill dispatch (the screen owns when/how to call skills via
 *     its existing `useSkill` / `useSkillResult` bindings; the
 *     adapter only declares WHICH skill via `dataSource` + WHICH
 *     args via `prefilledParams`).
 *   - No reply-shape normalisation (different list-skills return
 *     different shapes — same forward-additive policy as
 *     `fetchSectionItems`).
 */

import { renderMobile }          from '@onderling/app-manifest';
import {
  fetchSectionItems,
  itemMatchesAppliesTo,
  applyPrefilledParams,
} from '@onderling/web-adapter';

/**
 * @param {object} manifest          per-app manifest (tasksManifest etc.)
 * @param {object} deps
 * @param {(skillId: string, args?: object) => Promise<*>} deps.callSkill
 *   App-side skill caller.  In tasks-mobile this is a thin wrapper
 *   over `useSkill('<id>').call(args)` (or the underlying
 *   `services.skills.invoke`); the adapter stays caller-agnostic so
 *   web + mobile + tests can supply the right shape.
 *
 * @returns {{
 *   navModel:             object,
 *   getSection:           (id: string) => object | undefined,
 *   fetchSection:         (section: object) => Promise<*>,
 *   renderItemActions:    (section: object, item: object) =>
 *                           Array<{opId: string, label: string, args: object}>,
 *   renderSectionActions: (section: object) =>
 *                           Array<{opId: string, label: string, args: object}>,
 * }}
 */
export function createNavModelAdapter(manifest, { callSkill } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('createNavModelAdapter: manifest required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('createNavModelAdapter: { callSkill } required');
  }

  // Compute the NavModel once at construction — manifest is static
  // for the app's lifetime.  Web shells re-fetch /navmodel.json over
  // HTTP; mobile imports the manifest module directly + projects
  // locally (no server round-trip).
  const navModel = renderMobile(manifest);

  // Index sections by id for O(1) lookup.  Section ordering still
  // honours `manifest.views[]` declaration order via `navModel.sections`.
  const sectionsById = new Map(
    (navModel.sections ?? []).map((s) => [s.id, s]),
  );

  function getSection(id) {
    return sectionsById.get(id);
  }

  function fetchSection(section) {
    return fetchSectionItems(section, { callSkill });
  }

  /**
   * Filter the section's itemActions[] by the manifest's appliesTo
   * gate and decorate each with the pre-filled args the adapter
   * would pass to `callSkill`.
   *
   * Decoration:
   *   - `args` = `applyPrefilledParams({ id: item.id }, action)` —
   *     manifest defaults + the conventional `{ id }` arg single-
   *     item ops take.  Callers may merge additional args (e.g.
   *     `note`, `reason`) before dispatch; the manifest's
   *     `paramsSchema` carries the required-fields contract.
   *   - `label` mirrors the NavModel's label (from `surfaces.ui.label`
   *     or `op.verb`).
   *
   * Mirrors the web shell's `_action(section, opId)` + inline
   * `applyPrefilledParams({ id }, _action(…))` pattern from
   * `apps/tasks-v0/web/mine.html` (DRY — same gate, same prefill).
   *
   * V0.4 per-event-kind gates (e.g. `kind: 'subtask-proposal'`) flow
   * through verbatim — see commit 83ce267 which lifted the generic-
   * field pass-through into `renderWeb.buildItemAction`.
   */
  function renderItemActions(section, item) {
    if (!section || typeof section !== 'object') return [];
    if (!item    || typeof item    !== 'object') return [];
    const actions = Array.isArray(section.itemActions) ? section.itemActions : [];
    const out = [];
    for (const a of actions) {
      if (!itemMatchesAppliesTo(a.appliesTo, item)) continue;
      out.push({
        opId:  a.opId,
        label: a.label,
        args:  applyPrefilledParams({ id: item.id }, a),
      });
    }
    return out;
  }

  /**
   * Slice C.4 (2026-05-20) — Q19 section-header CTAs.
   *
   * Mirrors `renderItemActions` for section-scope ops (ops with
   * `surfaces.ui.placement: 'section-header'`).  The web shell pattern
   * (apps/tasks-v0/web/inbox.html → renderSectionActions) iterates
   * `section.sectionActions ?? []` directly; this method lifts the
   * same logic into the adapter so RN screens (InboxScreen first) get
   * a symmetric API to the per-row case.
   *
   * Decoration:
   *   - `args` = `applyPrefilledParams({}, action)` — V0.4 section
   *     actions take no per-item id (clearInbox is bulk).  Manifest-
   *     declared prefills still apply (none declared in V0).
   *   - `label` mirrors the NavModel's label (from `surfaces.ui.label`
   *     or `op.verb`).
   *
   * Returns `[]` when the section is falsy OR carries no
   * `sectionActions[]` (renderWeb only sets the field when at least
   * one section-header op matched).
   */
  function renderSectionActions(section) {
    if (!section || typeof section !== 'object') return [];
    const actions = Array.isArray(section.sectionActions) ? section.sectionActions : [];
    const out = [];
    for (const a of actions) {
      out.push({
        opId:  a.opId,
        label: a.label,
        args:  applyPrefilledParams({}, a),
      });
    }
    return out;
  }

  return {
    navModel,
    getSection,
    fetchSection,
    renderItemActions,
    renderSectionActions,
  };
}
