/**
 * tasksInLists — the TASKS app's `accepts` declaration over the lists substrate (surfacing).
 *
 * This is the composition seam the -SPIKE (plans PLAN-capabilities-tasks-roles.md "-SPIKE VERDICT")
 * decided on: a `list` and a `list-item` ALSO accept `task` CHILDREN — making the long-advertised
 * "offer→list→tasks→…" nesting REAL — with NO new type and WITHOUT unifying `task` with `list-item` (they
 * stay DISTINCT: `list-item` is a deliberate 3-field leaf; `task` carries the full status/assignee/DoD
 * lifecycle). `buildAcceptsPolicy` merges this per container type (first-declarer-per-child-type wins), so
 * `list` → `[list-item (default), task]`: a bare "add" still creates a `list-item`, while the shell's type
 * picker (`acceptsFor`/`addKinds`) now also offers `task`. `task` is a NON-DEFAULT alternative — it never
 * displaces the default checklist row.
 *
 * `task` is the canonical noun from `@onderling/item-types` (registered on the lists store's registry via
 * `registerCanonicalTypes`), so no extra type registration is needed for a container to hold task children.
 *
 * TODO(P1c — subtask-nesting convergence): this wires ONLY "a list container can hold task ITEMS" via
 * containment. It deliberately does NOT declare `task: [{ type: 'task', op: 'addSubtask' }]` — structural
 * subtask nesting (today `tasks-v0`'s immutable `parentTaskId`) is a SEPARATE later step that must converge
 * onto containment (`containedBy`) while preserving the `parentTaskId` authz (spawn perms / master
 * inheritance / depth-approval). See PLAN-capabilities-tasks-roles.md -SPIKE VERDICT ("TWO containment
 * mechanisms → converge on ONE"). When that lands, add the `task` self-accept entry HERE.
 */
export const TASKS_ACCEPTS_MANIFEST = Object.freeze({
  app: 'tasks',
  accepts: {
    // A `list` / a `list-item` ALSO accepts a `task` child — offered ALONGSIDE `list-item` (which stays the
    // default), so a bare add keeps making a checklist row and the picker gains `task` as an alternative.
    list:        [{ type: 'task', op: 'addTask' }],
    'list-item': [{ type: 'task', op: 'addTask' }],
  },
});
