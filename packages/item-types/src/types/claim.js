/**
 * `claim` — "I want to act on a specific post." A claim binds a
 * second party to a specific `offer` or `request` and tracks the
 * coordination lifecycle (requested → agreed → in-progress →
 * completed | cancelled).
 *
 * Replaces the legacy `lend-request` type. The shape is general
 * enough to cover lend/borrow, give/receive, gig-style claims on
 * neighbourhood-jobs, and any future flow that needs "match against
 * a specific posted item".
 *
 * Standardisation: Phase 52.1 vocabulary refresh (2026-05-12).
 * Legacy name `lend-request` is still recognised as an alias for
 * this type while consumers migrate.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CLAIM_SCHEMA = {
  iri:         `${NAMESPACE}Claim`,
  description: 'A specific claim against an offer or request.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'itemRef'],
  properties: {
    ...BASE_PROPERTIES,
    type: { const: 'claim' },
    /**
     * URI of the offer or request being claimed against. Cross-pod
     * refs are fine; the substrate's embeds traversal resolves them.
     */
    itemRef: { type: 'string', minLength: 1 },
    /**
     * Coarse-grained lifecycle the substrate enforces. Fine-grained
     * states ('handed-over', 'returned' for lend flows; 'paid' for
     * buy flows) live on app-level extension fields rather than in
     * the canonical enum.
     */
    status: {
      type: 'string',
      enum: ['requested', 'agreed', 'in-progress', 'completed', 'cancelled'],
    },
    body:        { type: 'string' },
    audience:    { type: 'array', items: { type: 'string' } },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
