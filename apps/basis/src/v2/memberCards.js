/**
 * basis v2 — member-card projections (LEDEN tab → persona card + self-view).
 *
 * Two thin projections the LEDEN (members) tab taps into, both PURE and both
 * reusing the already-built machinery — no new visibility logic lives here:
 *
 *   • member-persona — tap a member row → what THIS viewer (me) may see of THAT
 *     member: `splitViewAsAttributes` (viewAsAttributes.js) run with viewer = me
 *     over the member's attributes.
 *   • self-view — tap your own row → "how others see me": pick a viewer kind
 *     (member / stranger / agent, per `VIEWER_KINDS` in circleViewAs.js) and the
 *     `{sees, hides}` split re-runs the same reveal rules over MY attributes.
 *
 * ── Re-homed onto the C7 reveal-state (Phase 4 Wave B) ──────────────────────
 * The one reveal-state home is `disclosure.js` (`@onderling/agent-registry`): a
 * per-(context, key) `{enabled, …}` policy, default-withhold, PLUS the amount
 * presets `handle → profile → full` (`REVEAL_PRESETS`). These cards now express
 * their result as that unified reveal-state and READ it back through
 * `isDisclosed`/`revealPresetOf` — the sees/hides split is driven by the
 * `enabled` axis, and each card SURFACES the amount preset it lands at. No
 * bespoke reveal truth lives here anymore; the presets are named by AMOUNT
 * (never a field name, never "verified"/identity).
 *
 * Disclosure is per-CIRCLE (context = the circle). Today the roster carries two
 * persona attributes — the handle (the pseudonym FLOOR, always shown) and the
 * real name (the presented self). We map them onto the preset tiers via
 * `personaPresetKeys` and let `revealPresetOf` name the amount. Richer per-member
 * attributes (picture, bio) — and the OTHER member's OWN per-circle reveal-state,
 * carried on the per-circle `Peer.revealState` slot — arrive with the Peer-façade
 * wiring (`packages/core/src/discovery/peerFacade.js`, still reserved); until then
 * the member-persona view derives the gate from the roster's pairwise `reveals`
 * and the circle policy. `matchable`/`requestable` are OTHER axes and never touch
 * the reveal card.
 */

import {
  createDisclosurePolicy, applyRevealPreset, isDisclosed, revealPresetOf, REVEAL_PRESETS,
} from '@onderling/agent-registry';
import { splitViewAsAttributes, viewAsCounts } from './viewAsAttributes.js';
import { VIEWER_KINDS } from './circleViewAs.js';

/**
 * The persona card's amount-preset key assignment (design §1.3, NOTE-reveal-state):
 * the handle is the pseudonym FLOOR (`handle` tier); the real name is the presented
 * self, and — as the top populated tier in a card that carries only handle + real
 * name — it rides the `profile` tier so that "real name shown" reads as the ceiling
 * (`full`, an empty top tier is vacuously satisfied above it). The two live states
 * today are therefore the floor `handle` and the ceiling `full`; the middle `profile`
 * label becomes reachable once picture/bio land as their own attributes (Wave B/C).
 * Per-tier OWN keys (non-cumulative) — `disclosure.js` makes them cumulative.
 */
export const PERSONA_TIER_KEYS = Object.freeze({ handle: ['handle'], profile: ['realName'], full: [] });

/** The persona tier's OWN keys for a preset (the `keysFor` the disclosure preset API expects). */
export function personaPresetKeys(preset) { return PERSONA_TIER_KEYS[preset] ?? []; }

// The reveal-state is read per (context, key); these cards build a per-VIEW policy, so the
// context id is an opaque, stable slot (the real per-circle context arrives with Peer.revealState).
const PERSONA_CTX = 'persona';

/**
 * Build the unified per-(context, key) reveal-state for ONE persona view from the set of
 * keys this viewer may see, then hand it back so the card can READ the `enabled` axis +
 * the amount preset. Real name in the seen set → the `full` amount preset (handle + real
 * name enabled); otherwise the `handle` floor (real name withheld). Only the `enabled`
 * axis is touched — `matchable`/`requestable` stay at their withheld default.
 *
 * @param {string[]} seenKeys  persona keys the viewer clears (from the view-as gate)
 * @returns {object} a disclosure policy (the reveal-state)
 */
function revealStateFromSeen(seenKeys) {
  const preset = (Array.isArray(seenKeys) && seenKeys.includes('realName')) ? 'full' : 'handle';
  return applyRevealPreset(createDisclosurePolicy(), PERSONA_CTX, preset, { keysFor: personaPresetKeys });
}

/**
 * Project a set of persona attributes through a reveal-state: an attribute is VISIBLE iff
 * it's the handle floor (the pseudonym is always shown) or the reveal-state marks its key
 * `enabled` for the context. Reads the unified `isDisclosed` — the split is driven by the
 * `enabled` axis, not a bespoke openness tag. Attribute order is preserved.
 *
 * @param {Array<{key:string}>} attributes
 * @param {object} revealState  a disclosure policy
 * @returns {{sees:object[], hides:object[]}}
 */
function splitByRevealState(attributes, revealState) {
  const sees = [];
  const hides = [];
  for (const a of attributes) {
    const shown = a.key === 'handle' || isDisclosed(revealState, PERSONA_CTX, a.key);
    (shown ? sees : hides).push(a);
  }
  return { sees, hides };
}

/**
 * The full reveal-state projection for a persona view: the view-as gate decides WHO clears
 * each attribute (viewer kind / pairwise / circle policy — the viewer axis, still owned by
 * `splitViewAsAttributes`); we then express that as the unified reveal-state, read the split
 * back off its `enabled` axis, and name the amount preset via `revealPresetOf`.
 *
 * @param {object} args
 * @param {Array<object>} args.attributes
 * @param {object} args.viewer   the view-as viewer context
 * @param {'open'|'pairwise'} args.policy
 * @returns {{sees:object[], hides:object[], counts:object, preset:string|null, revealState:object}}
 */
function projectRevealState({ attributes, viewer, policy }) {
  const gate = splitViewAsAttributes({ attributes, viewer, policy });
  const revealState = revealStateFromSeen(gate.sees.map((a) => a.key));
  const split = splitByRevealState(attributes, revealState);
  const preset = revealPresetOf(revealState, PERSONA_CTX, { keysFor: personaPresetKeys });
  return { ...split, counts: viewAsCounts(split), preset, revealState };
}

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
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}, preset:string|null, revealState:object}}
 */
export function memberPersonaView({ member, viewerWebid = null, policy = 'pairwise' } = {}) {
  const m = member && typeof member === 'object' ? member : {};
  const revealedToMe = (viewerWebid && Array.isArray(m.reveals) && m.reveals.includes(viewerWebid))
    ? ['realName'] : [];
  const viewer = { kind: 'member', id: viewerWebid ?? null, revealedToMe };
  return projectRevealState({ attributes: personaAttributes(m), viewer, policy });
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
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}, preset:string|null, revealState:object}}
 */
export function selfViewSplit({ me, viewer = { kind: 'stranger' }, policy = 'pairwise' } = {}) {
  const m = me && typeof me === 'object' ? me : {};
  const v = viewer && typeof viewer === 'object' ? viewer : {};
  const revealedToMe = (v.kind === 'member' && v.id && Array.isArray(m.reveals) && m.reveals.includes(v.id))
    ? ['realName'] : [];
  const enrichedViewer = { ...v, revealedToMe };
  return projectRevealState({ attributes: personaAttributes(m), viewer: enrichedViewer, policy });
}

/**
 * The user-facing label KEY for a reveal preset (invariant 8 — resolved via `t()`, never a
 * baked string). `handle → profile → full` (the pinned amount vocabulary). A null preset
 * (nothing reaches even the floor) has no label.
 * @param {string|null} preset  one of REVEAL_PRESETS, or null
 * @returns {string|null}
 */
export function revealPresetLabelKey(preset) {
  return REVEAL_PRESETS.includes(preset) ? `circle.reveal.preset.${preset}` : null;
}

export { VIEWER_KINDS, REVEAL_PRESETS };
