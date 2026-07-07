/**
 * `contact` type — a person the user knows. Shared across all
 * three apps (Tasks circle membership, Stoop contacts, Folio
 * share recipients).
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CONTACT_SCHEMA = {
  iri:         `${NAMESPACE}Contact`,
  description: 'A person the user knows. webid + displayName + optional trust + flags.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'displayName'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'contact' },
    webid:       { type: 'string' },
    pubKey:      { type: 'string' },
    stableId:    { type: 'string' },
    displayName: { type: 'string', minLength: 1 },
    trustLevel:  { type: 'string', enum: ['unknown', 'bekend', 'vertrouwd'] },
    flags:       { type: 'object' },
    tags:        { type: 'array', items: { type: 'string' } },
  },
};
