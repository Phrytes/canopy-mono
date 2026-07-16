/**
 * screenPanelDrilldown — the MOBILE binding of the shared Q15 screen
 * drill-down (web twin: circleApp's `openCircleScreenPanel`).
 *
 * Invariant #1: NO drill/selection/fetch logic lives here — it all comes
 * from shared `apps/canopy-chat/src/v2/screenDrilldown.js` (consumed by
 * both shells).  This module only binds the two mobile-specific choices:
 *   - the projector is `renderMobile` (so the pair derivation never forks
 *     from what the mobile shell actually renders), and
 *   - the host context shape (`{circleId, ...selection}` — `$circleId`
 *     from the active circle, selection keys from a picked row).
 *
 * Portable (zero RN / zero DOM) so the launcher's panel wiring is
 * unit-testable in vitest (which excludes src/screens entirely).
 */
import { renderMobile } from '@onderling/app-manifest';
import {
  drilldownForSection, selectionContextFor, fetchScreenItems, itemsFromReply, recordFromReply,
} from '../../../canopy-chat/src/v2/screenDrilldown.js';

// Shared selection/fetch seam, re-exported so the RN shell imports ONE
// module for the whole panel fetch path (no second import site to drift).
export { selectionContextFor, fetchScreenItems, itemsFromReply, recordFromReply };

/**
 * The panel's FETCH CONTEXT: the host materializes `$circleId` (the active
 * circle — web parity with openCircleScreenPanel's `screenContext`) plus
 * any SELECTION context a drill-down row-pick passed in (`$uri` /
 * `$agentId` ← the picked row).
 *
 * @param {string|null|undefined} circleId
 * @param {object|null|undefined} selection  the opener-supplied selection context
 * @returns {object}
 */
export function screenPanelContext(circleId, selection) {
  return { circleId, ...(selection && typeof selection === 'object' ? selection : {}) };
}

/**
 * The drill-down target for a mobile panel's LIST screen — shared
 * `drilldownForSection` with `renderMobile` bound (the selection logic
 * must not fork per platform) and the panel's context keys as hostKeys.
 * `null` → the rows stay plain (no row-open affordance), mirroring web.
 *
 * @param {Object<string, object>} manifestsByOrigin
 * @param {string} screenId
 * @param {object} screenContext   from {@link screenPanelContext}
 * @returns {ReturnType<typeof drilldownForSection>}
 */
export function drilldownForScreen(manifestsByOrigin, screenId, screenContext = {}) {
  return drilldownForSection(manifestsByOrigin, screenId, {
    hostKeys: Object.keys(screenContext ?? {}),
    renderer: renderMobile,
  });
}

/**
 * Q17 — the read-only key→value rows a `shape:'record'` reply renders as
 * (the RN twin of web recordScreen's inline formatting: nullish → '—',
 * nested → JSON, else String).  Pure so the record screen's model is
 * assertable without a native render.
 *
 * @param {object|null|undefined} record  from {@link recordFromReply}
 * @returns {Array<{key: string, text: string}>}
 */
export function recordFields(record) {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, value]) => ({
    key,
    text: value == null ? '—' : (typeof value === 'object' ? JSON.stringify(value) : String(value)),
  }));
}
