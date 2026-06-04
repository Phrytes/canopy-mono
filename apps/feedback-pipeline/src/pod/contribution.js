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
  themeTags: z.array(z.string()).default([]),
  // COARSE time window only (e.g. "2026" or "2026-Q2") — never a precise timestamp,
  // which would be a fingerprint. Optional.
  timeWindow: z.string().regex(/^\d{4}(-Q[1-4])?$/).optional(),
  lang: z.enum(['nl', 'en']).optional(),
}).strict();

/** Validate a contribution (used by BOTH layers). Throws a zod error if invalid. */
export function validateContribution(raw) {
  return ContributionSchema.parse(raw);
}

/** Build a contribution from an approved Task-1 point ({id, text}). */
export function buildContribution(point, { timeWindow, lang, themeTags = [] } = {}) {
  return validateContribution({ id: point.id, text: point.text, themeTags, timeWindow, lang });
}
