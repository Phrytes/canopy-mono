/**
 * `request` — "I want X." Author's stance: looking for something
 * from others. Inner `kind` carries the verb (borrow / receive / buy
 * / help). Same shape symmetry as `offer`.
 *
 * Standardisation: Phase 52.1 vocabulary refresh (2026-05-12).
 * Legacy name `demand-offer` is still recognised as an alias for this
 * type while consumers migrate.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const REQUEST_SCHEMA = {
  iri:         `${NAMESPACE}Request`,
  description: 'A broadcast request — the author wants something.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type: { const: 'request' },
    body: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['borrow', 'receive', 'buy', 'help', 'other'],
    },
    audience:    { type: 'array', items: { type: 'string' } },
    expiresAt:   { type: 'string', format: 'date-time' },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
