/**
 * `offer` — "I have X available." Author's stance: providing something
 * to others. The inner `kind` carries the verb (lend / give / sell /
 * help). Scales across buurt sharing, gift economy, time-banking, and
 * marketplace-style flows without renaming the type.
 *
 * Standardisation: Phase 52.1 vocabulary refresh (2026-05-12).
 * Legacy name `supply-offer` is still recognised as an alias for this
 * type while consumers migrate.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const OFFER_SCHEMA = {
  iri:         `${NAMESPACE}Offer`,
  description: 'A broadcast offer — the author has something available.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type: { const: 'offer' },
    body: { type: 'string' },
    /**
     * Verb-direction subfield. Strongly recommended in practice;
     * absence is tolerated so apps can post under-specified offers
     * during early UX flows.
     */
    kind: {
      type: 'string',
      enum: ['lend', 'give', 'sell', 'help', 'other'],
    },
    audience:    { type: 'array', items: { type: 'string' } },
    expiresAt:   { type: 'string', format: 'date-time' },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
