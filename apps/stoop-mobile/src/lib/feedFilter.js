/**
 * feedFilter — pure helper for FeedScreen.  Filters a list of items
 * by kind / skill / distance, given a viewer location.
 *
 * Lifted into a lib so the screen UI is render-only and the filter
 * logic gets direct unit-test coverage.
 */

import { distanceKm } from './geo.js';

/**
 * Item `type`s that belong on the Feed (the "Prikbord" — the public
 * group board).  `listOpen()` returns every uncompleted item in the
 * store regardless of type; chat messages, group-rules,
 * membership-codes and other internal items live in the same store
 * and were leaking into the Feed.  Whitelist what's actually a
 * board-visible post.
 *
 * Phase 52.7.2 cut-over (2026-05-14, clean break per Decision 1):
 * after Stoop's `postRequest` started writing canonical
 * `@onderling/item-types` shape, the whitelist switched to the
 * canonical types. Pre-migration items (`type: 'ask'`/`'lend'`/etc.)
 * are no longer visible — this is a deliberate clean break per the
 * Stoop open-questions 2026-05-12 doc. The "Aanbod" / "Te leen" tab
 * split is now expressed as `type: 'offer'` with `kind` narrowing on
 * the server side (`listOpen({intent: 'lend'})` →
 * `type: 'offer', kind: 'lend'`).
 *
 * `report` stays on the whitelist as a bespoke type (admin
 * moderation; outside the canonical taxonomy by design).
 */
const FEED_VISIBLE_TYPES = new Set([
  'offer', 'request', 'claim', 'announcement', 'report',
]);

/**
 * @param {object} item — Stoop item shape (`{kind, skills, cell, ...}`)
 * @param {object} filter
 * @param {Set<string>|null} [filter.kinds]      one of {'vraag', 'aanbod'}; null = both
 * @param {Set<string>|null} [filter.skills]     skill ids; null = any
 * @param {number|null}      [filter.maxDistKm]  null = no distance limit
 * @param {string|null}      [filter.viewerCell] required when maxDistKm is set
 * @returns {boolean}
 */
export function matchesFilter(item, filter = {}) {
  if (!item) return false;
  // Type whitelist — keep chat-messages / group-rules / membership
  // items off the board.
  const t = item.type ?? item.kind ?? '';
  if (!FEED_VISIBLE_TYPES.has(t)) return false;
  const { kinds, skills, maxDistKm, viewerCell } = filter;
  if (kinds && kinds.size > 0 && !kinds.has(item.kind ?? item.type ?? '')) return false;
  if (skills && skills.size > 0) {
    const itemSkills = Array.isArray(item.skills) ? item.skills : [];
    if (!itemSkills.some((s) => skills.has(s))) return false;
  }
  if (typeof maxDistKm === 'number' && Number.isFinite(maxDistKm)) {
    if (typeof viewerCell !== 'string' || typeof item.cell !== 'string') return false;
    const d = distanceKm(viewerCell, item.cell);
    if (typeof d !== 'number' || d > maxDistKm) return false;
  }
  return true;
}

/**
 * Apply `matchesFilter` over a list, preserving order.
 */
export function filterFeed(items, filter) {
  if (!Array.isArray(items)) return [];
  return items.filter((it) => matchesFilter(it, filter));
}
