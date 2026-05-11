/**
 * `lend-request` type — a borrow lifecycle entry. References a
 * supply-offer via the `itemRef` field; the lifecycle states
 * track claim → handover → return → close.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const LEND_REQUEST_SCHEMA = {
  iri:         `${NAMESPACE}LendRequest`,
  description: 'A lend-lifecycle entry; refs a supply-offer + tracks state.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'itemRef'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'lend-request' },
    itemRef:   { type: 'string', minLength: 1 },
    requester: { type: 'string' },
    lender:    { type: 'string' },
    dueDate:   { type: 'string', format: 'date-time' },
    status:    {
      type: 'string',
      enum: ['requested', 'agreed', 'handed-over', 'returned', 'closed', 'cancelled'],
    },
  },
};
