/**
 * canopy-chat v2 — the claim-conflict SURFACE (PLAN-task-claim-partition
 * Slice 3). A double-claim recorded by the tasks substrate mirror
 * (`{taskId, localAssignee, incomingAssignee, …}`) is rendered + resolved by
 * REUSING the existing per-block recipe-conflict machinery (`recipeConflict`):
 * a claim-conflict is modelled as a one-block "recipe" whose single block is
 * the disputed assignment, so `detectRecipeConflicts` gives the card its
 * yours/theirs/both shape and `applyResolution` computes the surviving
 * claimant(s) — `'both'` keeps the local claimant AND the incoming one under a
 * fresh id, exactly like the block case.
 *
 * This is the thin chat-side projector; the authoritative write lives in
 * tasks-v0's `resolveClaim` op. No I/O here — pure mapping over recipeConflict.
 */

import { detectRecipeConflicts, applyResolution } from './recipeConflict.js';

/** The disputed-assignment block id for a task. */
const claimBlockId = (taskId) => `claim:${taskId}`;

/** Model one side of a claim-conflict as a single-block recipe. */
function claimSideRecipe(taskId, text, assignee) {
  return {
    id:     taskId,
    name:   text ?? taskId,
    blocks: [{ id: claimBlockId(taskId), type: 'claim', config: { assignee } }],
  };
}

/**
 * Detect the (single) block-conflict for a recorded claim-conflict. Returns
 * the `recipeConflict` report — `blockConflicts` has one entry (the disputed
 * assignment) the card renders with Keep-yours / Take-theirs / Keep-both.
 *
 * @param {{taskId:string, text?:string, localAssignee:string, incomingAssignee:string}} conflict
 */
export function detectClaimConflict(conflict) {
  const local    = claimSideRecipe(conflict.taskId, conflict.text, conflict.localAssignee);
  const incoming = claimSideRecipe(conflict.taskId, conflict.text, conflict.incomingAssignee);
  return detectRecipeConflicts(local, incoming, null);
}

/**
 * Resolve a claim-conflict via `applyResolution` and return the surviving
 * claimant webids:
 *   - 'yours'  → [localAssignee]
 *   - 'theirs' → [incomingAssignee]
 *   - 'both'   → [localAssignee, incomingAssignee]   (incoming kept under a
 *                fresh block id — both survive)
 *
 * @param {{taskId:string, text?:string, localAssignee:string, incomingAssignee:string}} conflict
 * @param {'yours'|'theirs'|'both'} decision
 * @returns {string[]} surviving claimant webids
 */
export function resolveClaimConflict(conflict, decision) {
  const local    = claimSideRecipe(conflict.taskId, conflict.text, conflict.localAssignee);
  const incoming = claimSideRecipe(conflict.taskId, conflict.text, conflict.incomingAssignee);
  const merged   = applyResolution(local, incoming, { [claimBlockId(conflict.taskId)]: decision });
  return merged.blocks.map((b) => b?.config?.assignee).filter((a) => a != null);
}
