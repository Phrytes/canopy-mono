/**
 * `apps/tasks-v0/src/mountable.js` — tasks-v0 as a `@onderling/manifest-
 * host` mountable.
 *
 * Bridges two shapes:
 *   - tasks-v0's SDK-native skills (`defineSkill({handler({parts, from,
 *     agent, envelope}) → reply})`) — registered on the meshAgent;
 *   - `@onderling/app-manifest`'s `renderChat` shape
 *     (`(args, skillCtx) → {replies, stateUpdates}`) — what
 *     `host.mount({skillRegistry, toSkillCtx, …})` expects.
 *
 * tasks-v0's existing wireSkills + multi-circle
 * bundleResolver machinery is the production wiring; mounting through
 * the host doesn't replace it — it bridges to it.  The adapter:
 *
 *   1. Wraps `(args, skillCtx)` into the SDK-skill ctor shape, packing
 *      args as a `DataPart` (the convention `skills/index.js` line 9–11
 *      documents) and forwarding `skillCtx.actorWebid` as `from`.
 *   2. Calls the SDK handler — which calls `bundleResolver(parts, ctx)`
 *      internally to resolve the right `CircleState`.  Multi-circle
 *      dispatch is therefore preserved end-to-end without the host or
 *      `renderChat` having to know about it.
 *   3. Wraps the SDK reply (a plain JSON object) as a single text
 *      reply for the chat-agent.  State updates flow through the
 *      itemStore directly — there is no separate `stateUpdates` array
 *      in the SDK shape (state changes are visible by re-reading the
 *      store), so we return an empty `stateUpdates: []`.  This is
 *      different from household's bridge convention; document for
 *      future consumers.
 *
 * Multi-circle note: the chat-agent's per-call `circleId` is passed through
 * `args` (the LLM declares it as a tool arg) OR injected by the
 * consumer's `toSkillCtx` closure (e.g. a per-session circle binding).
 * V0 demo uses the latter — see `examples/manifest-host-demo/`.
 */

import { DataPart } from '@onderling/core';

import { tasksManifest } from '../manifest.js';

/**
 * Build a `host.mount()`-compatible shape from a live tasks-v0 mesh
 * agent + circlesMap.
 *
 * @param {object} args
 * @param {object} args.meshAgent
 *   The meshAgent returned by `buildMultiCircleRuntime` (or the
 *   single-circle equivalent).  Used to look up SDK skill defs by id.
 * @param {Map<string, object>} args.circlesMap
 *   The live circlesMap.  Exposed so consumers can introspect or write
 *   per-session circle-binding logic.
 * @param {{operations: Array<{id: string}>}} [args.manifest]
 *   Defaults to `tasksManifest` (the V0 manifest with 12 ops).
 *   Override for tests that mount a subset.
 *
 * @returns {{
 *   skillRegistry: Record<string, function>,
 *   toSkillCtx:    (toolCtx: object) => object,
 *   onStateUpdates?: (updates: Array) => void,
 *   circlesMap:      Map<string, object>,
 * }}
 *   The circlesMap is re-exposed so consumers can read it without
 *   passing two refs around.
 */
export function createTasksMountable({ meshAgent, circlesMap, manifest = tasksManifest }) {
  if (!meshAgent || typeof meshAgent.skills?.get !== 'function') {
    throw new TypeError('createTasksMountable: meshAgent with .skills.get required');
  }
  if (!(circlesMap instanceof Map)) {
    throw new TypeError('createTasksMountable: circlesMap (Map<circleId, CircleState>) required');
  }

  const skillRegistry = {};
  for (const op of manifest.operations) {
    const skillDef = meshAgent.skills.get(op.id);
    if (!skillDef) continue;     // op declared without backing skill — let drift canary catch it
    skillRegistry[op.id] = adaptSdkSkill(skillDef, meshAgent);
  }

  return {
    skillRegistry,
    toSkillCtx: (toolCtx) => toolCtx,  // identity — SDK skill reads `from` not the ctx
    onStateUpdates: () => {},          // SDK skills mutate itemStore directly
    circlesMap,                          // re-exposed for consumer introspection
  };
}

/* ─── internals ──────────────────────────────────────────────────────── */

/**
 * Wrap an SDK-native skill def into a renderChat-compatible function.
 *
 * @param {{id: string, handler: function}} skillDef
 * @param {object} meshAgent
 */
function adaptSdkSkill(skillDef, meshAgent) {
  return async (args, skillCtx) => {
    const reply = await skillDef.handler({
      parts:    [DataPart(args ?? {})],
      from:     skillCtx?.actorWebid ?? skillCtx?.from ?? null,
      agent:    meshAgent,
      envelope: null,
    });
    return {
      replies:      [{ type: 'text', text: stringifyReply(reply) }],
      stateUpdates: [],  // SDK skills already mutated the itemStore directly
    };
  };
}

function stringifyReply(reply) {
  if (reply == null)            return 'ok';
  if (typeof reply === 'string') return reply;
  if (reply.error)              return `error: ${reply.error}`;
  // Compact JSON keeps replies LLM-readable without overwhelming the
  // chat window; consumers wanting prettier text can post-process.
  try { return JSON.stringify(reply); }
  catch                         { return String(reply); }
}
