/**
 * Skills barrel — re-exports the v0 SkillHandlers.
 *
 * Each handler conforms to `(args, ctx) → Promise<Reply>`
 * (see `../types.js`).  The agent looks them up by id.
 */

// B · Layer 1 — the single shared CREATE path behind the `add` atom
// (addItem for list nouns, addTask for the task noun both call it).
export { createHouseholdItem } from './createHouseholdItem.js';

// SP-1 skills (user-facing list / completion / removal / help)
export { addItem }          from './addItem.js';
export { listOpen }         from './listOpen.js';
export { markComplete }     from './markComplete.js';
export { removeItem }       from './removeItem.js';
export { help }             from './help.js';

// SP-2 skills (tasks + contacts)
export { addTask }          from './addTask.js';
export { listTasks }        from './listTasks.js';
export { claim }            from './claim.js';
export { reassign }         from './reassign.js';
export { registerName }     from './registerName.js';

// Q30 — brief-summary contributor for canopy-chat's /brief aggregator.
export { briefSummary }     from './briefSummary.js';

// Scheduler-invoked (not user-facing dispatch)
export { nudgeCompletion }  from './nudgeCompletion.js';
export { composeDigest }    from './composeDigest.js';
