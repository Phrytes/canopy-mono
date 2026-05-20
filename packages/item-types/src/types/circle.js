/**
 * `circle` type — a saved audience.  A circle is a named, persisted
 * set of members (+ optional named roles).  Used wherever an
 * audience is referenced by id (e.g. `{kind: 'circle-ref', id}`) in
 * the `@canopy/circles` audience model.
 *
 * ──── ALIAS NOTE — CIRCLE ID ≡ CREW ID (SP-5 V0, 2026-05-20) ──────
 *
 * **A `circle.id` value and a `task.crewId` value share the SAME
 * string identifier space.**  i.e. if a task has `crewId: "abc-123"`
 * and a circle exists with `id: "abc-123"`, they describe the
 * *same* group.  V0 ships this as a documented alias rather than
 * renaming `crewId` to `circleId` across the codebase — the rename
 * is mechanical but big-blast-radius and not needed yet.
 *
 * Why this matters for future readers:
 *   - Searching the codebase for `crewId` will surface task / pod-
 *     routing code; searching for `circle.id` will surface circles-
 *     substrate code.  They refer to the same underlying group.
 *   - Pod-routing's `crewPolicy(crewId)` resolves storage paths for
 *     a group; the matching `circle` item adds the audience-resolve
 *     layer over that same identifier.
 *   - A future "kill crewId, use circle.id everywhere" refactor is
 *     SP-5b (or later) once consumers exist.
 *
 * The marker constant `CIRCLE_ID_IS_CREW_ID_ALIAS` (exported below)
 * is greppable — searching it surfaces this comment as the canonical
 * reference for the alias.
 * ─────────────────────────────────────────────────────────────────
 *
 * Reserved field-name notes:
 *   - `text` is NOT in the schema, but `@canopy/item-store`'s
 *     `addItems` requires a non-empty `text` on every partial;
 *     consumers writing circles via the store should set
 *     `text: name`.  Substrate fix deferred to SP-5b.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

/**
 * Greppable marker — searching for this constant surfaces the alias
 * comment above as the canonical reference.  Do NOT remove without
 * also resolving the alias (rename `crewId` everywhere, or break the
 * shared-identifier-space contract).
 */
export const CIRCLE_ID_IS_CREW_ID_ALIAS = true;

export const CIRCLE_SCHEMA = {
  iri:         `${NAMESPACE}Circle`,
  description:
    'A saved audience: a named set of members + optional named roles. ' +
    'circle.id and task.crewId share the same string identifier space ' +
    '(see CIRCLE_ID_IS_CREW_ID_ALIAS in src/types/circle.js).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'name'],
  properties: {
    ...BASE_PROPERTIES,
    type:    { const: 'circle' },
    name:    { type: 'string', minLength: 1 },
    members: { type: 'array', items: { type: 'string' } },
    // roles: a record of role-name → list of webids in that role.
    // Optional; consumers that don't need named roles leave it absent.
    roles: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
};
