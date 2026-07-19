/**
 * The standard `embeds: [{type, ref}, …]` field shape.
 *
 * Every type schema includes `embeds` via the BASE_PROPERTIES spread
 * (see baseSchema.js). The substrate guarantees the shape across
 * all types so cross-app embed-by-ref (chat → task, task → note,
 * etc.) works uniformly.
 *
 * Validation is **structural only**:
 *   - `type` must be a non-empty string (any value — refs may
 *     point at types not registered in this client).
 *   - `ref`  must be a non-empty string (typically a URI).
 *   - Extra fields per-embed are allowed (forward-compat).
 *
 * The substrate does NOT verify that the referenced `type` is
 * registered locally. Cross-pod refs may legitimately point at
 * types this client doesn't know about; the receiver renders
 * them via the interface-registry's default permission-denied /
 * unknown-type fallback.
 */

export const EMBEDS_SCHEMA = Object.freeze({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', minLength: 1 },
      ref:  { type: 'string', minLength: 1 },
    },
    required: ['type', 'ref'],
    additionalProperties: true,
  },
});
