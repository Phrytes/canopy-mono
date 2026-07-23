/**
 * basis v2 — member-card projections (LEDEN tab → persona card + self-view).
 *
 * Two thin projections the LEDEN (members) tab taps into, both PURE and both
 * reusing the already-built reveal/openness machinery — no new visibility logic
 * lives here:
 *
 *   • member-persona — tap a member row → what THIS viewer (me) may see of THAT
 *     member: `splitViewAsAttributes` (viewAsAttributes.js) run with viewer = me
 *     over the member's attributes.
 *   • self-view — tap your own row → "how others see me": pick a viewer kind
 *     (member / stranger / agent, per `VIEWER_KINDS` in circleViewAs.js) and the
 *     `{sees, hides}` split re-runs the same reveal rules over MY attributes.
 *
 * A circle roster (`normalizeCircleMembers` → the canonical `{id, handle,
 * realName, reveals}`) carries exactly two persona attributes TODAY — the handle
 * (always visible) and the real name (revealed per the reveal rules). We project
 * that pair into the openness-tagged attribute shape the built `splitViewAsAttributes`
 * consumes; richer per-member props arrive with the Peer.reveal-state substrate
 * (peer-connectivity Phase 4 Wave B/C). This module only ADAPTS the roster into
 * that shape and calls the built split — every visibility decision stays in
 * `isVisibleTo`.
 */

import { splitViewAsAttributes, viewAsCounts } from './viewAsAttributes.js';
import { VIEWER_KINDS } from './circleViewAs.js';

/**
 * Project a canonical roster member into the openness-tagged attribute list the
 * built `splitViewAsAttributes` consumes. Handle → `public` (always visible per
 * the circleViewAs model); real name → `pairwise` (revealed to a member who was
 * revealed to, or under an 'open' policy). `labelKey` rides through the split so
 * the shell resolves it via `t()` (no strings baked in here — invariant 8).
 *
 * @param {{handle?:string|null, realName?:string|null}} member
 * @returns {Array<{key:string, labelKey:string, value:any, openness:string}>}
 */
export function personaAttributes(member) {
  const m = member && typeof member === 'object' ? member : {};
  const out = [];
  if (m.handle) {
    out.push({ key: 'handle', labelKey: 'circle.memberCard.attr.handle', value: `@${m.handle}`, openness: 'public' });
  }
  out.push({ key: 'realName', labelKey: 'circle.memberCard.attr.realName', value: m.realName ?? null, openness: 'pairwise' });
  return out;
}

/**
 * member-persona — what THIS viewer (me) may see of THAT member. The member's
 * real name is 'revealed to me' iff they put my webid in their `reveals` list
 * (or the circle policy is 'open', which `isVisibleTo` handles). Pure projection
 * over the built split.
 *
 * @param {object}  args
 * @param {{id?:string, handle?:string|null, realName?:string|null, reveals?:string[]}} args.member
 * @param {string|null} [args.viewerWebid]  my webid (the viewer)
 * @param {'open'|'pairwise'} [args.policy='pairwise']  the circle's revealPolicy
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}}}
 */
export function memberPersonaView({ member, viewerWebid = null, policy = 'pairwise' } = {}) {
  const m = member && typeof member === 'object' ? member : {};
  const revealedToMe = (viewerWebid && Array.isArray(m.reveals) && m.reveals.includes(viewerWebid))
    ? ['realName'] : [];
  const viewer = { kind: 'member', id: viewerWebid ?? null, revealedToMe };
  const split = splitViewAsAttributes({ attributes: personaAttributes(m), viewer, policy });
  return { ...split, counts: viewAsCounts(split) };
}

/**
 * self-view — how a CHOSEN viewer sees ME. For a member viewer, my real name is
 * 'revealed to them' iff I put their webid in MY `reveals` list; a stranger/agent
 * never clears the pairwise gate. Pure projection over the built split.
 *
 * @param {object}  args
 * @param {{id?:string, handle?:string|null, realName?:string|null, reveals?:string[]}} args.me
 * @param {{kind?:string, id?:string|null}} [args.viewer]  the chosen viewer (VIEWER_KINDS)
 * @param {'open'|'pairwise'} [args.policy='pairwise']  the circle's revealPolicy
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}}}
 */
export function selfViewSplit({ me, viewer = { kind: 'stranger' }, policy = 'pairwise' } = {}) {
  const m = me && typeof me === 'object' ? me : {};
  const v = viewer && typeof viewer === 'object' ? viewer : {};
  const revealedToMe = (v.kind === 'member' && v.id && Array.isArray(m.reveals) && m.reveals.includes(v.id))
    ? ['realName'] : [];
  const enrichedViewer = { ...v, revealedToMe };
  const split = splitViewAsAttributes({ attributes: personaAttributes(m), viewer: enrichedViewer, policy });
  return { ...split, counts: viewAsCounts(split) };
}

export { VIEWER_KINDS };
