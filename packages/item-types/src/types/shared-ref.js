/**
 * `shared-ref` type — a cross-circle SHARE (the share-into-audience op). An explicit, per-item
 * grant: a reference placed in a TARGET circle's store pointing at a source item in ANOTHER circle. It is NOT a
 * copy and NOT a transitive grant — it exposes ONLY the referenced item, never its container or siblings.
 * Resolving the ref crosses circles = the 🔒-gated cross-pod read (ACP + seal enforce it on real pods). Carries
 * the `posture` the share was made at, so the target can refuse a confidentiality downgrade (the posture floor).
 */
import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const SHARED_REF_SCHEMA = {
  iri:         `${NAMESPACE}SharedRef`,
  description: 'A cross-circle reference to a source item shared into this circle (per-item, no transitive grant).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'sourceCircle', 'sourceId'],
  properties: {
    ...BASE_PROPERTIES,
    type:         { const: 'shared-ref' },
    sourceCircle: { type: 'string' },                 // the circle the item lives in
    sourceId:     { type: 'string' },                 // the source item's id
    sourceType:   { type: 'string' },                 // the source item's type (for rendering without resolving)
    sharedBy:     { type: 'string' },                 // who shared it
    posture:      { type: ['number', 'string'] },     // the seal/posture the share was made at (the floor it met)
  },
};
