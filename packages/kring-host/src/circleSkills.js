/**
 * canopy-chat v2 — skill 4-axis model + match list (shared, board 8).
 *
 * A skill is a structured object across four axes (board 8): how openly it
 * is shared (`openness`), whether the offer is fixed or up for negotiation
 * (`posture`), its lifecycle (`status`), and how far it reaches (`radius`).
 * This module is the pure model: enum tables, a default skill, normalisation
 * (coerce a stored partial onto valid enum values), and deep-merge for edits
 * — mirroring circlePolicy's normalize/merge exactly. It also normalises an
 * INJECTED match list into tagged rows (human / agent / via-hop) — no
 * fetching or discovery here; the host supplies the matches. Local discovery
 * (mDNS/BLE "who's here") is intentionally NOT part of this slice.
 */

export const SKILL_AXES = {
  openness: ['private', 'circle', 'contacts', 'public'],
  posture:  ['always', 'negotiable'],
  status:   ['active', 'paused', 'archived'],
  radius:   ['home', 'street', 'neighbourhood', 'city'],
};

export const DEFAULT_SKILL = {
  name:     '',
  openness: 'private',
  posture:  'always',
  status:   'active',
  radius:   'home',
};

/** Coerce any stored partial into a complete, valid skill (invalid axis values fall back to defaults; `name` kept). */
export function normalizeSkill(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const pickEnum = (axis) =>
    SKILL_AXES[axis].includes(s[axis]) ? s[axis] : DEFAULT_SKILL[axis];
  return {
    name:     typeof s.name === 'string' ? s.name : DEFAULT_SKILL.name,
    openness: pickEnum('openness'),
    posture:  pickEnum('posture'),
    status:   pickEnum('status'),
    radius:   pickEnum('radius'),
  };
}

/** Deep-merge an edit `patch` onto `base`, then normalise. */
export function mergeSkill(base, patch = {}) {
  return normalizeSkill({ ...normalizeSkill(base), ...patch });
}

export const MATCH_SOURCES = ['human', 'agent', 'via-hop'];

/** Normalise an INJECTED match list into `{ id, label, source }` rows (source coerced into MATCH_SOURCES, default 'human'). */
export function buildSkillMatches({ matches = [] } = {}) {
  const list = Array.isArray(matches) ? matches : [];
  return list
    .filter((m) => m && typeof m === 'object')
    .map((m, i) => ({
      id:     typeof m.id === 'string' && m.id ? m.id : `match-${i}`,
      label:  typeof m.label === 'string' ? m.label : '',
      source: MATCH_SOURCES.includes(m.source) ? m.source : 'human',
    }));
}
