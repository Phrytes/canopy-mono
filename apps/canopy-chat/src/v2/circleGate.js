// circleGate.js — the circle bot's deterministic pre-LLM gate, DERIVED FROM THE MANIFEST.
//
// Replaces the hand-written circleGateRules.js. "add X" / "done X" / "claim X" now come from the task
// ops' `surfaces.slash.match` declarations (mockManifests.js) via `renderGate` — the SAME projection
// household's TG-bot uses (`renderSlash`). So the deterministic gate, the slash surface, and the LLM
// tool surface (`renderChat`) all read one source of truth instead of a parallel hand-written copy.
//
// Relative import of the substrate (not the '@canopy/app-manifest' alias) so the same module resolves
// under both vite (web) and metro (mobile imports this file from canopy-chat/src/v2).
//
// Part C (2026-06-11): projects the circle apps' manifests so the gate covers tasks/stoop/folio/
// calendar user-action verbs. Cross-app verb collisions (share/accept/reject/cancel) were resolved at
// the manifest level (each verb has one owner; losers dropped the bare token). renderGate is
// first-match-wins across the flattened rules, preserving each op's verb order (multiword before bare).
//
// household-mock is DELIBERATELY EXCLUDED from the circle gate: the circle's items are TASKS (not
// household chores), so its add/done verbs would be shadowed by tasks and its remove/list verbs would
// mis-target a chore. Household ops still reach the LLM path; household's own gate verbs serve the
// household TG-bot surface (its real manifest), not the circle.

import { renderGate } from '../../../../packages/app-manifest/src/renderGate.js';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../core/manifests/mockManifests.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { CIRCLE_GATE_TRAIL, DEFAULT_GATE_LOCALE } from './circleGateLexicon.js';

/**
 * Token-gate rules for the circle bot, projected from the circle apps' manifests.
 *
 * `locale` (the user's language, 'en' | 'nl') enables the per-locale TRAILING-verb pass so casual
 * phrasing like "kaas done" / "afwas klaar" routes through the deterministic gate instead of falling
 * to the (unreliable) small LLM. Leading verbs are language-neutral on the manifest; only trailing is
 * locale-scoped (circleGateLexicon). Defaults to English.
 */
export function circleGateRules(locale = DEFAULT_GATE_LOCALE) {
  const loc = CIRCLE_GATE_TRAIL[locale] ? locale : DEFAULT_GATE_LOCALE;
  return [
    // Household TYPED-LIST add (prepended, first-match-wins). The tasks-derived gate below treats EVERY
    // "add" as a generic addTask and DROPS the list qualifier (see circleGate.test "add X to the list").
    // But a household circle has typed lists — shopping/errand/repair/schedule — so "add bananas to the
    // shopping list" must reach addItem({type:'shopping'}), not addTask. This catches the TYPED phrasing
    // (English + common Dutch); generic "add X to the list" (no type word) returns null → falls through
    // to the unchanged addTask rule. Types mirror the household manifest's addItem enum.
    { name: 'household:addItem(typed-list)', test: HH_ADD_TYPED, command: householdTypedListAdd },
    ...renderGate([
      mockTasksManifest,
      mockStoopManifest,
      mockFolioManifest,
      calendarManifest,
    ], { locale: loc, trailLexicon: CIRCLE_GATE_TRAIL }),
  ];
}

// alias → canonical household list type (the addItem `type` enum: shopping·errand·repair·schedule).
const HH_LIST_ALIASES = {
  shopping: 'shopping', groceries: 'shopping', grocery: 'shopping',
  boodschappen: 'shopping', boodschappenlijst: 'shopping', boodschappenlijstje: 'shopping',
  errand: 'errand', errands: 'errand', klusje: 'errand', klusjes: 'errand',
  repair: 'repair', repairs: 'repair', reparatie: 'repair', reparaties: 'repair',
  schedule: 'schedule', schedules: 'schedule', agenda: 'schedule',
};
// "add <item> to [the] <type> [list]" · "noteer <item> op de <type>lijst" · "voeg <item> toe aan de <type>"
const HH_ADD_TYPED =
  /^(?:add|noteer|zet|voeg)\s+(.+?)\s+(?:toe\s+)?(?:to|on|op|aan|naar)\s+(?:the\s+|de\s+|het\s+|my\s+|mijn\s+)?([a-zA-Z]+?)(?:[-\s]?(?:list|lijst|lijstje))?\.?$/i;

/**
 * "add X to the <type> list" → `addItem({type, text:X})` when <type> is a known household list type;
 * otherwise null so the generic addTask rule handles it. Pure + deterministic (gate-safe).
 * @param {string} text
 * @returns {{opId:'addItem', args:{type:string, text:string}}|null}
 */
function householdTypedListAdd(text) {
  const m = HH_ADD_TYPED.exec(String(text || '').trim());
  if (!m) return null;
  const item = m[1].trim();
  const type = HH_LIST_ALIASES[m[2].toLowerCase()];
  if (!item || !type) return null;   // no known list type → generic add (addTask) takes it
  return { opId: 'addItem', args: { type, text: item } };
}
