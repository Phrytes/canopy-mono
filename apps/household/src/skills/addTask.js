/**
 * skills/addTask — create a new task item.
 *
 * args  : { text: string, assignee?: string, dueAt?: number }
 * ctx   : SkillContext
 * reply : "✓ added task: <text>" + an `item.added` stateUpdate.
 *
 * B · Layer 1 — this is the `add` atom resolved for the `task` noun.  The
 * store-write, the optional inline reassignment, and the `item.added`
 * emission live in the single shared `createHouseholdItem` create path
 * (which `addItem` also uses for the list nouns); this handler only supplies
 * the task-noun wording.  Behaviour is byte-identical to the pre-
 * consolidation handler.
 *
 * When `assignee` is supplied, the task is reassigned to that webid right
 * after creation (single-pass; LWW).  SP-2 V0 has no inline DAG / dependency
 * wiring — those land via the manifest's forward-compat hook to
 * `@onderling/protocol` (PLAN guardrail #9).
 */

import { createHouseholdItem } from './createHouseholdItem.js';

export async function addTask(args, ctx) {
  const { text, assignee, dueAt } = args ?? {};

  return createHouseholdItem('task', { text, dueAt, assignee }, ctx, {
    emptyText: `Couldn't add task — text is empty.`,
    reply:     (item) => `✓ added task: ${item.text}`,
  });
}
