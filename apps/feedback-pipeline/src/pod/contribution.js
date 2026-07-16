// The central-pod CONTRIBUTION: one approved point a participant has handed over.
//
// It carries NO identity — identity lives in the per-participant container (the pod
// path / pseudonym), never in the contribution body. This is the shape BOTH layers
// validate (build proposal §1.4, "two-layer validation"): the agent/bot before
// sending, and the central side defensively on write. `.strict()` rejects unknown
// keys, so no identity field can be smuggled in.

import { z } from 'zod';

export const ContributionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  // The participant's ORIGINAL message, kept on their OWN pod for their records (Stage-1 review choice).
  // Own-pod-only: aggregation/summary uses `text` (cleaned+verified), never `raw`, so it can't reach central.
  raw: z.string().optional(),
  // TRUE when the participant changed the text themselves (in-app [Bewerk] or a channel-side
  // message edit) — so a reader knows this isn't the verbatim first utterance. Coarse, non-identifying.
  edited: z.boolean().optional(),
  themeTags: z.array(z.string()).default([]),
  // COARSE time window only (e.g. "2026" or "2026-Q2") — never a precise timestamp,
  // which would be a fingerprint. Optional.
  timeWindow: z.string().regex(/^\d{4}(-Q[1-4])?$/).optional(),
  lang: z.enum(['nl', 'en']).optional(),
  // Property layer (charter). OPTIONAL disclosed COARSE background attributes — a map of
  // vocabulary key → coarse value (e.g. {place:'Utrecht', ageBand:'35-54'}), chosen by the
  // participant from the charter's requested set. Values are already coarse (from the
  // @canopy/attribute-charter VOCABULARY); NO name / free-text ever rides here. Absent =
  // withheld (no marker). The aggregation attributeK-suppresses rare combos at READ.
  attributes: z.record(z.string(), z.string()).optional(),
  // The hash of the charter the participant agreed to (binds this disclosure to a specific,
  // capped request). Rides alongside; not identifying (identical for everyone on the charter).
  charterHash: z.string().optional(),
}).strict();

/** Validate a contribution (used by BOTH layers). Throws a zod error if invalid. */
export function validateContribution(raw) {
  return ContributionSchema.parse(raw);
}

/** Build a contribution from an approved Task-1 point ({id, text, raw?}). Keeps `raw` only when it differs
 *  from the curated text (no point storing a copy when the AI/edit changed nothing). `attributes` +
 *  `charterHash` (property layer) are ADDITIVE — omitting them yields exactly the pre-charter shape. */
export function buildContribution(point, { timeWindow, lang, themeTags = [], attributes, charterHash } = {}) {
  const keepRaw = point.raw && point.raw !== point.text;
  return validateContribution({
    id: point.id, text: point.text, ...(keepRaw ? { raw: point.raw } : {}),
    ...(point.edited ? { edited: true } : {}),   // tg-hardening: the participant edited after review
    themeTags, timeWindow, lang,
    ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
    ...(charterHash ? { charterHash } : {}),
  });
}
