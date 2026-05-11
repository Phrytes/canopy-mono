/**
 * `announcement` type — a broadcast to a crew (or sub-audience).
 * Stoop's group announcements; Tasks's crew-wide notices.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const ANNOUNCEMENT_SCHEMA = {
  iri:         `${NAMESPACE}Announcement`,
  description: 'A broadcast post to a crew or sub-audience.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'announcement' },
    title:     { type: 'string' },
    body:      { type: 'string' },
    audience:  { type: 'array', items: { type: 'string' } },
    pinUntil:  { type: 'string', format: 'date-time' },
  },
};
