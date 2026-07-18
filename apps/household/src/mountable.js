/**
 * `apps/household/src/mountable.js` — household as a `@onderling/manifest-
 * host` mountable.
 *
 * extracted from `HouseholdAgent.js`'s
 * renderChat callsite (lines 140–172) so that the household skill
 * surface composes into a multi-app host without needing a full
 * HouseholdAgent.  Used by `examples/manifest-host-demo/` to mount
 * household alongside tasks-v0.
 *
 * household's skills are already `(args, skillCtx) → {replies,
 * stateUpdates}` — the renderChat shape — so no adapter is needed
 * (unlike tasks-v0's SDK skills).  The mountable simply binds the
 * caller-supplied `store` + optional `scheduler` into the
 * `toSkillCtx` closure + the `onStateUpdates` forwarder.
 *
 * Shape returned matches what `host.mount(appId, manifest, opts)`
 * accepts — drop straight in.
 */

import { HOUSEHOLD_SKILL_REGISTRY } from './skillRegistry.js';

/**
 * @param {object} args
 * @param {object} args.store
 *   A Store-shaped object (e.g. `InMemoryStore`) the household
 *   skills mutate.  Bound into every `skillCtx`.
 * @param {object} [args.scheduler]
 *   Optional scheduler with `onStateUpdate(update)` — receives the
 *   state-update stream emitted by household skills.  Mirrors
 *   `HouseholdAgent`'s scheduler wiring.
 * @param {object} [args.agent]
 *   Optional opaque "agent" reference passed through to skills via
 *   `skillCtx.agent` (some skills use it for `ctx.agent.llm` lookups
 *   etc.).  Pass `null`/omit if no such consumer exists.
 * @returns {{
 *   skillRegistry: Record<string, function>,
 *   toSkillCtx:    (toolCtx: object) => object,
 *   onStateUpdates: (updates: Array) => void,
 * }}
 */
export function createHouseholdMountable({ store, scheduler, agent } = {}) {
  if (!store) {
    throw new TypeError('createHouseholdMountable: store required');
  }

  return {
    skillRegistry: HOUSEHOLD_SKILL_REGISTRY,

    toSkillCtx: (toolCtx) => ({
      store,
      chatId:      toolCtx?.chatId,
      senderWebid: toolCtx?.actorWebid,
      bridgeId:    toolCtx?.bridgeId,
      agent:       agent ?? null,
    }),

    onStateUpdates: (updates) => {
      if (!scheduler || typeof scheduler.onStateUpdate !== 'function') return;
      for (const u of updates) {
        try { scheduler.onStateUpdate(u); }
        catch (err) {
          // Mirror HouseholdAgent.js's "log + continue" — a scheduler
          // hiccup must not kill the user-facing reply.
          // eslint-disable-next-line no-console
          console.error(
            '[household/mountable] scheduler.onStateUpdate threw:',
            err?.message ?? err,
          );
        }
      }
    },
  };
}
