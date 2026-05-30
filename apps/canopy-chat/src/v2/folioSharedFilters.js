/**
 * canopy-chat v2 — Folio "Shared by me / Shared with me" filters
 * (P6.M8, board 10B).
 *
 * Board 10B sits next to "My things" ([[folioMyThings]], board 10A) as
 * two toggle filters on the same Folio screen:
 *
 *   - `shared-by-me`   — items I own that are shared into ≥1 circle
 *   - `shared-with-me` — items owned by someone else that are visible to
 *                        me through ≥1 circle I'm in
 *
 * The substrate is a pure projector — it takes the raw Folio list, my
 * webid, the circles I'm in, and a filter mode, and returns the rows
 * the screen should render.  Sort is newest-first, matching the rest
 * of the Folio surface.
 */

import { itemCircleId } from './circleScope.js';
import { itemOwner } from './folioMyThings.js';
import { normalizeFolioFile } from './circleFolio.js';

/** Filter modes a Folio screen can ask for. */
export const FOLIO_SHARE_FILTERS = ['shared-by-me', 'shared-with-me'];

function asIdSet(circles) {
  const out = new Set();
  if (!Array.isArray(circles)) return out;
  for (const c of circles) {
    if (typeof c === 'string') { if (c) out.add(c); continue; }
    if (c && typeof c === 'object' && c.id) out.add(c.id);
  }
  return out;
}

/** Is `item` shared by me?  Mine + carries a circle hint. */
export function isSharedByMe(item, myId) {
  if (!item || typeof item !== 'object') return false;
  if (itemCircleId(item) == null) return false;
  const owner = itemOwner(item);
  if (owner == null) return false;             // unknown owner → don't claim
  return myId != null && owner === myId;
}

/**
 * Is `item` shared with me?  Owned by someone else AND scoped to a
 * circle I'm in.  `myCircles` may be a list of ids or circle objects.
 */
export function isSharedWithMe(item, myId, myCircles) {
  if (!item || typeof item !== 'object') return false;
  const circleId = itemCircleId(item);
  if (circleId == null) return false;
  const owner = itemOwner(item);
  if (owner == null) return false;             // unknown owner → can't tell
  if (myId != null && owner === myId) return false;
  return asIdSet(myCircles).has(circleId);
}

/**
 * Project the Folio list to the rows the chosen filter should render.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.files=[]]      raw Folio items
 * @param {?string}  [opts.myId=null]     active user's webid
 * @param {(string|object)[]} [opts.myCircles=[]] circles I'm in
 * @param {'shared-by-me'|'shared-with-me'} opts.filter
 * @returns {{ id, name, kind, size, updatedAt, circleId, owner }[]}
 */
export function buildSharedFiles({ files = [], myId = null, myCircles = [], filter } = {}) {
  if (!FOLIO_SHARE_FILTERS.includes(filter)) return [];
  const list = Array.isArray(files) ? files : [];
  const keep = filter === 'shared-by-me'
    ? (f) => isSharedByMe(f, myId)
    : (f) => isSharedWithMe(f, myId, myCircles);
  return list
    .filter(keep)
    .map((f) => ({
      ...normalizeFolioFile(f),
      circleId: itemCircleId(f),
      owner:    itemOwner(f),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Convenience wrapper around a `listFiles` op result.
 */
export function sharedFilesFromListFiles(result, opts = {}) {
  const files = result && typeof result === 'object'
    ? (Array.isArray(result.items) ? result.items
      : Array.isArray(result.files) ? result.files
        : Array.isArray(result) ? result : [])
    : [];
  return buildSharedFiles({ ...opts, files });
}
