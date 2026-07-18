/**
 * basis v2 — "View as…" per-attribute split.
 *
 * The "View as…" screen shows a SPECIFIC preview: when I pick a viewer (Sara, an
 * agent, a stranger), the screen splits MY profile into "WHAT SARA
 * SEES" (skill X · weekend availability) and "WHAT SARA DOESN'T SEE"
 * (real name · street · belasting-aangifte family-only · borrow-offer
 * Selwerd-only) so I can FEEL what I've exposed.  The existing
 * `viewAsDirectory` is the member-list projection; this is the
 * per-row split renderers consume.
 *
 * Pure: hosts pass MY attributes (each with an `openness` enum) + the
 * chosen viewer + the active circle's reveal policy; we return
 * `{sees, hides}` arrays the renderer styles directly.
 *
 * Openness ladder (most-open → least-open):
 *
 *   public           - anyone (incl. strangers, agents)
 *   public-locale    - anyone in the same region (host decides locale match)
 *   members          - any member of any of my circles
 *   circle-members   - any member of the active circle
 *   pairwise         - only viewers I've explicitly revealed to
 *   family           - manually-marked family connections
 *   private          - just me (never visible in a viewer preview)
 *
 * The host's "viewer" context is `{kind, id, circleId, revealedToMe}`:
 *   kind          : 'member' | 'stranger' | 'agent' (per VIEWER_KINDS in circleViewAs.js)
 *   id            : viewer id (used for pairwise reveals)
 *   circleId      : the active circle id (used by circle-members gate)
 *   revealedToMe  : (optional) set of attribute keys / ids the local user
 *                   has explicitly revealed to this viewer (pairwise reveal map)
 *   inMyLocale    : (optional) boolean — passes the public-locale gate
 *   isFamily      : (optional) boolean — passes the family gate
 *   sharesCircle  : (optional) boolean — passes the circle-members gate
 *                   (defaults to true when kind === 'member')
 */

import { VIEWER_KINDS } from './circleViewAs.js';

export const OPENNESS_LEVELS = [
  'public',
  'public-locale',
  'members',
  'circle-members',
  'pairwise',
  'family',
  'private',
];

/**
 * Decide whether `viewer` clears the openness gate on `attribute`.
 *
 * @param {object} attribute   `{key, openness}` (other fields ignored)
 * @param {object} viewer      see module-doc for shape
 * @param {object} [opts]
 * @param {'open'|'pairwise'} [opts.policy='pairwise']  active circle's revealPolicy
 * @returns {boolean}
 */
export function isVisibleTo(attribute, viewer = {}, { policy = 'pairwise' } = {}) {
  const openness = OPENNESS_LEVELS.includes(attribute?.openness) ? attribute.openness : 'pairwise';
  if (openness === 'private') return false;
  if (openness === 'public')  return true;

  const kind        = VIEWER_KINDS.includes(viewer.kind) ? viewer.kind : 'stranger';
  const isMember    = kind === 'member';
  const isAgent     = kind === 'agent';
  const isStranger  = kind === 'stranger';
  const sharesCircle = isMember && (viewer.sharesCircle !== false);
  const inMyLocale   = !!viewer.inMyLocale;
  const isFamily     = !!viewer.isFamily;
  const revealedHere = isMember && hasPairwiseReveal(viewer.revealedToMe, attribute?.key);

  switch (openness) {
    case 'public-locale':
      return isMember || isAgent || (isStranger && inMyLocale);

    case 'members':
      return isMember;

    case 'circle-members':
      return sharesCircle;

    case 'pairwise':
      // The circle's revealPolicy=='open' opens pairwise across members.
      if (isMember && policy === 'open') return true;
      return revealedHere;

    case 'family':
      return isFamily;

    default:
      return false;
  }
}

function hasPairwiseReveal(map, key) {
  if (!map || !key) return false;
  if (map instanceof Set) return map.has(key);
  if (Array.isArray(map)) return map.includes(key);
  if (typeof map === 'object') return !!map[key];
  return false;
}

/**
 * Split MY attributes into "what the viewer sees" vs "what they don't".
 *
 * @param {object} args
 * @param {Array<{key:string, label?:string, value?:any, openness?:string}>} args.attributes
 * @param {object} args.viewer
 * @param {'open'|'pairwise'} [args.policy='pairwise']
 * @returns {{ sees: object[], hides: object[] }}
 */
export function splitViewAsAttributes({ attributes = [], viewer = {}, policy = 'pairwise' } = {}) {
  const sees = [];
  const hides = [];
  for (const attr of attributes || []) {
    if (!attr || typeof attr !== 'object') continue;
    const enriched = { ...attr, openness: OPENNESS_LEVELS.includes(attr.openness) ? attr.openness : 'pairwise' };
    if (isVisibleTo(enriched, viewer, { policy })) sees.push(enriched);
    else                                            hides.push(enriched);
  }
  return { sees, hides };
}

/**
 * Convenience: count the two columns + the most-private level the
 * viewer manages to clear.  Useful for header copy ("4 of 7 visible").
 */
export function viewAsCounts(split) {
  const sees = Array.isArray(split?.sees)  ? split.sees  : [];
  const hides = Array.isArray(split?.hides) ? split.hides : [];
  return { visible: sees.length, hidden: hides.length, total: sees.length + hides.length };
}
