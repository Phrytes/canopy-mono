/**
 * `note` type — a markdown note. Owned by Folio but expressed
 * in substrate-shared terms.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const NOTE_SCHEMA = {
  iri:         `${NAMESPACE}Note`,
  description: 'A markdown note. body is the markdown source; tags + frontmatter optional.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'note' },
    title:       { type: 'string' },
    body:        { type: 'string' },
    tags:        { type: 'array', items: { type: 'string' } },
    frontmatter: { type: 'object' },
  },
};
