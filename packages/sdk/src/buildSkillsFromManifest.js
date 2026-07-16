/**
 * buildSkillsFromManifest — the shared manifest-op → core → `wireSkill` loop.
 *
 * folio (browser + node) and agents each hand-rolled the SAME tiny loop:
 * take a set of `manifest.operations`, look each op's pure core up in a
 * `{ opId: coreFn }` map, wrap it with `wireSkill(core, op, { storeFor })`, and
 * return `[{ id, handler, visibility }]` for the caller to `agent.register`.
 * This is that loop, factored out ONCE so the three builders can't drift.
 *
 *     import { buildSkillsFromManifest } from '@onderling/sdk';         // (bare barrel)
 *     // …or, from a browser/RN bundle that must stay node-free:
 *     import { buildSkillsFromManifest } from '.../packages/sdk/src/buildSkillsFromManifest.js';
 *
 *     export const buildFolioSkills = ({ store }) => buildSkillsFromManifest({
 *       operations: folioManifest.operations.filter((op) => op.runtime === 'browser'),
 *       cores:      FOLIO_CORES,
 *       storeFor:   () => store,
 *       label:      'buildFolioSkills',
 *     });
 *
 * RESOLUTION / BROWSER-BOUNDARY: like `wireSkill`, this helper is a zero-node
 * module (its only import is `wireSkill.js`, whose only import is
 * `connectSkill.js` — a node-free 2-file closure). Browser/RN callers import it
 * by RELATIVE PATH from `packages/sdk/src/` rather than the bare `@onderling/sdk`
 * barrel, because the barrel re-exports `@onderling/transports` etc. which drag in
 * node deps. Callers that already have `@onderling/sdk` on a node-safe path (e.g.
 * agents) may bare-import it.
 *
 * The op SELECTION (runtime filter, an explicit id list, …) is the caller's job:
 * pass `operations` already narrowed to exactly the ops this builder wires, in
 * the exact order the builder wants them registered. This helper only does the
 * per-op core-lookup → wire → shape step, uniformly.
 *
 * @param {object} args
 * @param {Array<{ id: string, visibility?: string, params?: Array, … }>} args.operations
 *        The manifest ops to wire — already filtered/ordered by the caller.
 * @param {Record<string, Function>} args.cores
 *        `{ opId: coreFn }` — the pure `(store, args, ctx) → result` cores.
 * @param {(ctx: object) => any} args.storeFor
 *        Resolves the scope store for an invocation (passed straight to `wireSkill`).
 * @param {boolean} [args.requireCore=true]
 *        When true (folio/agents strictness), throw if an op has no matching core
 *        — the anti-drift guard that keeps op⟷core parity. When false, ops with
 *        no core are skipped.
 * @param {(op: object) => (string|undefined)} [args.visibilityFor]
 *        Resolves the registration visibility for an op. Defaults to the op's own
 *        `op.visibility` (folio's convention — often `undefined`). agents passes a
 *        constant (`() => 'authenticated'`) because its manifest ops declare none.
 * @param {string} [args.label='buildSkillsFromManifest']
 *        Prefix for the missing-core error, so the throw names the calling builder.
 * @returns {Array<{ id: string, handler: Function, visibility?: string }>}
 */
import { wireSkill } from './wireSkill.js';

export function buildSkillsFromManifest({
  operations,
  cores,
  storeFor,
  requireCore = true,
  visibilityFor,
  label = 'buildSkillsFromManifest',
} = {}) {
  if (!Array.isArray(operations)) {
    throw new TypeError(`${label}: operations must be an array of manifest ops`);
  }
  if (!cores || typeof cores !== 'object') {
    throw new TypeError(`${label}: cores must be an { opId: coreFn } object`);
  }
  if (typeof storeFor !== 'function') {
    throw new TypeError(`${label}: storeFor must be a function`);
  }
  const visibilityOf = typeof visibilityFor === 'function'
    ? visibilityFor
    : (op) => op.visibility;

  const out = [];
  for (const op of operations) {
    const core = cores[op.id];
    if (!core) {
      if (requireCore) throw new Error(`${label}: no core for manifest op "${op.id}"`);
      continue;   // lenient mode: skip ops without a core
    }
    out.push({
      id:         op.id,
      handler:    wireSkill(core, op, { storeFor }),
      visibility: visibilityOf(op),
    });
  }
  return out;
}
