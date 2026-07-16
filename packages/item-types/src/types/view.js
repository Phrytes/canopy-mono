/**
 * `view` type — a saved view: a title + the item type it lists +
 * optional filter + optional audience.  A "view" is itself an item,
 * so views can be created, shared, and referenced like any other
 * piece of data (SP-5 V0).
 *
 * The `audience` field — when present — narrows who sees this view
 * (and, via host wiring, items created through it).  V0 accepts any
 * canonical `Audience` shape (string short-hand or structured); the
 * resolution / inheritance semantics live in `@onderling/circles` and
 * are wired by the host in SP-5b.
 *
 * Reserved field-name notes:
 *   - The discriminator field is `type: { const: 'view' }`, so the
 *     *kind of items* a view lists is named `itemType` (NOT `type`).
 *   - `text` is NOT in the schema — but `@onderling/item-store`'s
 *     `addItems` substrate currently requires a non-empty `text` on
 *     every partial; consumers that write views via the store should
 *     set `text: title` for substrate compatibility.  Substrate fix
 *     deferred to SP-5b.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const VIEW_SCHEMA = {
  iri:         `${NAMESPACE}View`,
  description: 'A saved view: title + listed item type + optional filter + optional audience.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'title', 'itemType'],
  properties: {
    ...BASE_PROPERTIES,
    type:     { const: 'view' },
    title:    { type: 'string', minLength: 1 },
    itemType: { type: 'string', minLength: 1 },
    filter:   { type: 'object' },
    // Audience is intentionally loose at the schema level — accepts
    // either a string short-hand or a structured object; the
    // canonical normaliser lives in `@onderling/circles`.  oneOf (not
    // a union `type: [...]`) keeps AJV strict-mode quiet.
    audience: { oneOf: [{ type: 'string' }, { type: 'object' }] },
  },
};
