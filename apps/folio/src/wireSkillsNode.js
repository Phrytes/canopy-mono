/**
 * buildFolioNodeSkills — the WIRE route for folio's NODE ops (Slice 1c,
 * follow-up to Slice 1b's `buildFolioSkills`; PLAN-folio-as-file-agent.md).
 *
 * The node sibling of `src/wireSkills.js#buildFolioSkills`: wraps each pure
 * core in `FOLIO_NODE_CORES` with `wireSkill(coreFn, op, { storeFor })`, so the
 * folioManifest op stays the single contract and the `defineSkill`-shaped
 * handler is DERIVED from it, not hand-rolled.  The set is manifest-derived:
 * EVERY folioManifest op tagged `runtime:'node'` (the local-SyncEngine control
 * surface — `syncOnce` / `watchStart` / `watchStop` / `forceRepush` /
 * `deleteLocally`) must have a core, and every node core must map to such an op
 * — the node fitness test fails CI otherwise.
 *
 * WHERE THIS IS WIRED (mirrors the Slice-1b precedent, `registerFolioAgent.js`):
 * folio has NO long-lived node-side `core.Agent` process today — the HTTP
 * server (`src/server/routes.js`) + the CLI own these ops directly.  So, exactly
 * like the browser side EXPOSES `buildFolioSkills` + `registerFolioAgent` for
 * the consuming composition (canopy-chat's browser agent boot) rather than
 * spinning up its own agent, this module EXPOSES `buildFolioNodeSkills` for the
 * eventual node composition (a `folio serve` agent, or a host chat agent that
 * embeds folio) to register on its agent once it has a live SyncEngine.  A new
 * long-lived agent is deliberately NOT invented here.
 *
 * SEPARATE FILE (not folded into `wireSkills.js`) so `browser.js` — which
 * imports `wireSkills.js` — never pulls the node core module into its module
 * graph, keeping the browser bundle engine-free by construction.
 *
 * RESOLUTION / BROWSER-BOUNDARY: `wireSkill` is imported by RELATIVE PATH from
 * `@canopy/sdk`'s source (not the bare barrel, which re-exports node transports)
 * — the SAME rationale + path as `src/wireSkills.js`.  `wireSkill.js` + its only
 * import `connectSkill.js` are a zero-dependency, node-free 2-file closure, and
 * folio's isolated `node_modules` has no `@canopy/sdk`.
 */
import { wireSkill } from '../../../packages/sdk/src/wireSkill.js';

import { folioManifest } from '../manifest.js';
import { FOLIO_NODE_CORES } from './nodeAgentCores.js';

/**
 * Folio's advertised NODE capabilities = the `runtime:'node'` op ids (the exact
 * ids `buildFolioNodeSkills` wires).  Derived from the manifest so the list
 * can't drift from the wired skills.  The eventual node composition advertises
 * the union with the browser set, e.g.
 * `[...FOLIO_CAPABILITIES, ...FOLIO_NODE_CAPABILITIES]`.
 */
export const FOLIO_NODE_CAPABILITIES = Object.freeze(
  folioManifest.operations
    .filter((op) => op.runtime === 'node')
    .map((op) => op.id),
);

/**
 * @param {object} args
 * @param {object} args.store  the injected node folio backend — `{ engine }`,
 *   where `engine` is the live `@canopy/sync-engine` SyncEngine (the SAME
 *   instance the HTTP routes drive).  Resolved for every ctx (folio's node
 *   surface is single-user / single-engine).
 * @returns {Array<{ id: string, handler: Function, visibility?: string }>}
 */
export function buildFolioNodeSkills({ store } = {}) {
  if (!store || typeof store !== 'object' || !('engine' in store)) {
    throw new TypeError('buildFolioNodeSkills: store with an `engine` (SyncEngine) required');
  }
  const storeFor = () => store;

  return folioManifest.operations
    .filter((op) => op.runtime === 'node')
    .map((op) => {
      const core = FOLIO_NODE_CORES[op.id];
      if (!core) {
        throw new Error(`buildFolioNodeSkills: no core for node manifest op "${op.id}"`);
      }
      return {
        id:         op.id,
        handler:    wireSkill(core, op, { storeFor }),
        // folio ops declare no manifest `visibility`; keep it undefined so
        // registration matches the browser side (agent.register(id, handler)).
        visibility: op.visibility,
      };
    });
}
