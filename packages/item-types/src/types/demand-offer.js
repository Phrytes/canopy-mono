/**
 * `demand-offer` type — "I need / want / am looking for X."
 * Stoop's canonical buurt-prikbord post on the demand side.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const DEMAND_OFFER_SCHEMA = {
  iri:         `${NAMESPACE}DemandOffer`,
  description: 'A buurt-style "I need / am looking for X" post.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'demand-offer' },
    body:        { type: 'string' },
    kind:        { type: 'string', enum: ['ask', 'borrow', 'help'] },
    audience:    { type: 'array', items: { type: 'string' } },
    expiresAt:   { type: 'string', format: 'date-time' },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
