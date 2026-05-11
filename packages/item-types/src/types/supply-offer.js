/**
 * `supply-offer` type — "I have / can do / lend X." Stoop's
 * canonical buurt-prikbord post on the supply side.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const SUPPLY_OFFER_SCHEMA = {
  iri:         `${NAMESPACE}SupplyOffer`,
  description: 'A buurt-style "I have / can do / lend X" post.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'supply-offer' },
    body:        { type: 'string' },
    kind:        { type: 'string', enum: ['offer', 'lend', 'give'] },
    audience:    { type: 'array', items: { type: 'string' } },
    expiresAt:   { type: 'string', format: 'date-time' },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
