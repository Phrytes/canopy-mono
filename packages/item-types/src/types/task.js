/**
 * `task` type — a shared crew task with optional dependencies +
 * DoD lifecycle. Owned by the Tasks app but expressed in
 * substrate-shared terms.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const TASK_SCHEMA = {
  iri:         `${NAMESPACE}Task`,
  description: 'A shared crew task. May reference other items via embeds + dependencies.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'text'],
  properties: {
    ...BASE_PROPERTIES,
    type:         { const: 'task' },
    text:         { type: 'string', minLength: 1 },
    status:       {
      type: 'string',
      enum: [
        'ready', 'waiting', 'blocked', 'claimed',
        'submitted', 'approved', 'rejected', 'revoked',
        'completed',
      ],
    },
    assignee:     { type: 'string' },
    dependencies: { type: 'array', items: { type: 'string' } },
    circleId:       { type: 'string' },
    dod:          { type: 'string' },
    approver:     { type: 'string' },
  },
};
