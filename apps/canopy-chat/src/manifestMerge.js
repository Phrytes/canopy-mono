/**
 * canopy-chat — manifest merge (thin shim over @canopy/manifest-host).
 *
 * The merge logic lives in `@canopy/manifest-host` (SP-4 substrate).
 * This file is a canopy-chat-shaped projection over that substrate:
 *
 *   - `host.compose()` produces a generic composed view with
 *     `appId.opId` namespacing + structured `collisions` data.
 *   - canopy-chat's parser + router + dispatch consume a SHAPE with
 *     `commandMenu: [{command, opId, appOrigin}]`, `opsById:
 *     Map<opId, {op, appOrigin}>`, `replyShapeFor(opId)`, and
 *     `warnings`.  This shim translates the substrate's output into
 *     that shape so the existing consumers don't churn.
 *
 * Architectural choice (per substrate-reuse audit 2026-05-22, see
 * `Project Files/canopy-chat/coding-plan.md` § Substrate-reuse gate):
 *   - Use the substrate underneath (composition + collision detection
 *     are its job; we don't reinvent).
 *   - Keep the canopy-chat-shaped projection (`opsById`,
 *     `replyShapeFor`) because manifest-host's output is generic;
 *     canopy-chat's consumers expect richer per-op lookups.
 *
 * Phase v0.1 sub-slice 1.5 (original) → v0.3.4 substrate-reuse
 * refactor 2026-05-22.
 */

import { validateManifest }   from '@canopy/app-manifest';
import { createManifestHost } from '@canopy/manifest-host';

/**
 * @typedef {object} MergedCatalog
 * @property {Array<{ command: string, opId: string, appOrigin: string }>} commandMenu
 * @property {Map<string, { op: object, appOrigin: string }>}              opsById
 * @property {(opId: string) => string | undefined}                        replyShapeFor
 * @property {(opId: string) => Array<{opId: string, prefilledArgs?: object}> | undefined} followUpsFor
 * @property {string[]}                                                    appOrigins
 * @property {string[]}                                                    warnings
 */

/**
 * @typedef {object} MergeOptions
 * @property {'browser' | 'node' | 'both'} [runtime='both']
 *   Filters out ops whose `op.runtime` doesn't match this runtime.
 *   - 'browser' → keeps ops with runtime 'browser' or 'both'; drops 'node'
 *   - 'node'    → keeps 'node' or 'both'; drops 'browser'
 *   - 'both'    → no filtering (default)
 *   Per OQ-1.A: canopy-chat in the browser passes 'browser' so folio's
 *   sync/watch family (runtime: 'node') stays out of the catalog.  A
 *   future sidecar deployment passes 'both' to re-include them.
 */

/**
 * Merge an array of `{manifest, callSkill?}` pairs into a canopy-chat
 * catalog.  Composes `@canopy/manifest-host` underneath.
 *
 * Op-prefix-on-collision policy:
 *   - When op-ids are unique across all manifests, the catalog uses
 *     bare opIds (`'markComplete'`).
 *   - When ≥2 manifests declare the SAME opId, the second-and-later
 *     declarations surface in `opsById` as `'<appOrigin>/<opId>'`
 *     (`'tasks-v0/markComplete'`).  The FIRST declaration keeps the
 *     bare form (no churn for solo apps).
 *   - Slash collisions still apply first-wins on the bare command
 *     (apps coordinate slash names per the existing convention).
 *
 * @param {Array<{ manifest: object, callSkill?: Function }>} sources
 * @param {MergeOptions} [opts]
 * @returns {MergedCatalog}
 */
export function mergeManifests(sources, opts = {}) {
  if (!Array.isArray(sources)) {
    throw new TypeError('mergeManifests: sources must be an array');
  }
  const wantRuntime = opts.runtime ?? 'both';

  const host        = createManifestHost();
  const warnings    = [];
  const opsById     = new Map();          // canonical key (bare or prefixed)
  const replyShape  = new Map();
  const followUps   = new Map();
  const embedSnapshot = new Map();
  const briefDecls    = new Map();        // v0.7 Q30 — canonicalKey → {summarySkill, order?, label?, appOrigin}
  const appOrigins  = [];
  /** @type {Map<string, string>} command → first-mounting appId */
  const commandOwner = new Map();
  const commandMenu = [];

  // Pre-pass 1: collect bare op-ids per app + identify collisions
  // across apps so we can apply prefix-on-collision in a second pass.
  /** @type {Map<string, Set<string>>} opId → set of appOrigins declaring it */
  const opIdAppearances = new Map();
  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') continue;
    for (const op of m.operations ?? []) {
      if (!opIdAppearances.has(op.id)) opIdAppearances.set(op.id, new Set());
      opIdAppearances.get(op.id).add(m.app);
    }
  }
  /** @type {Map<string, string>} opId → the app that "owns" the bare form (first declarer) */
  const bareOwner = new Map();

  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') {
      warnings.push('mergeManifests: skipping source with no manifest');
      continue;
    }

    const { ok, errors } = validateManifest(m);
    if (!ok) {
      throw new Error(
        `mergeManifests: invalid manifest from "${m.app}": ${JSON.stringify(errors)}`,
      );
    }

    const stub = {};
    for (const op of m.operations ?? []) {
      stub[op.id] = async () => ({ replies: [], stateUpdates: [] });
    }

    let mounted;
    try {
      mounted = host.mount(m.app, m, {
        skillRegistry: stub,
        toSkillCtx:    (c) => c,
      });
    } catch (err) {
      if (/already mounted/.test(String(err?.message))) {
        warnings.push(
          `app collision: "${m.app}" mounted twice; v0.1 keeps the first.`,
        );
        continue;
      }
      throw err;
    }

    appOrigins.push(m.app);

    for (const op of m.operations ?? []) {
      // Q32 runtime filter — drop ops that don't run in our runtime.
      if (!matchesRuntime(op.runtime ?? 'both', wantRuntime)) continue;

      // commandMenu: first-wins by slash command (bare commands).
      if (op?.surfaces?.slash?.command) {
        const command = op.surfaces.slash.command;
        const owner   = commandOwner.get(command);
        if (owner && owner !== m.app) {
          warnings.push(
            `slash collision: "${command}" declared by both "${owner}" and "${m.app}"; v0.1 keeps the first.`,
          );
        } else {
          commandOwner.set(command, m.app);
          commandMenu.push({ command, opId: op.id, appOrigin: m.app });
        }
      }

      // Op-id prefix-on-collision: when multiple apps declare the
      // same op id, only the FIRST app gets the bare key; the rest
      // get '<app>/<id>' keys so dispatch is unambiguous.
      const isColliding = (opIdAppearances.get(op.id)?.size ?? 0) > 1;
      let canonicalKey;
      if (!isColliding) {
        canonicalKey = op.id;
      } else if (!bareOwner.has(op.id)) {
        canonicalKey = op.id;
        bareOwner.set(op.id, m.app);
      } else {
        canonicalKey = `${m.app}/${op.id}`;
        // Surface the policy decision as a warning so consumers can
        // see which ops became prefixed.
        warnings.push(
          `op-id collision: "${op.id}" also declared by "${m.app}"; canopy-chat exposes it as "${canonicalKey}".`,
        );
      }
      opsById.set(canonicalKey, { op, appOrigin: m.app });

      // Q28 + Q31 lookups from the substrate's renderChat output.
      const shape = mounted.rendered.replyShapeFor?.(op.id);
      if (shape) replyShape.set(canonicalKey, shape);

      const fu = mounted.rendered.followUpsFor?.(op.id);
      if (Array.isArray(fu) && fu.length > 0) followUps.set(canonicalKey, fu);

      // Q29 (v0.5) embed snapshot skill lookup.
      const skill = mounted.rendered.embedSnapshotFor?.(op.id);
      if (skill) embedSnapshot.set(canonicalKey, { snapshotSkill: skill, appOrigin: m.app });

      // Q30 (v0.7) brief summary skill lookup.
      const brief = mounted.rendered.briefFor?.(op.id);
      if (brief) briefDecls.set(canonicalKey, { ...brief, appOrigin: m.app });
    }
  }

  return {
    commandMenu,
    opsById,
    replyShapeFor:    (opId) => replyShape.get(opId),
    followUpsFor:     (opId) => followUps.get(opId),
    embedSnapshotFor: (opId) => embedSnapshot.get(opId),
    briefFor:         (opId) => briefDecls.get(opId),
    // v0.7 — flattened brief decls, order-sorted, for /brief fan-out.
    briefAggregations: () => [...briefDecls.entries()]
      .map(([opId, decl]) => ({ opId, ...decl }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    appOrigins,
    warnings,
  };
}

/**
 * Q32 runtime filter — does an op's declared runtime match the
 * environment the chat shell is composing for?
 *
 * @param {'browser' | 'node' | 'both'} opRuntime
 * @param {'browser' | 'node' | 'both'} wantRuntime
 * @returns {boolean}
 */
function matchesRuntime(opRuntime, wantRuntime) {
  if (wantRuntime === 'both') return true;
  if (opRuntime === 'both')   return true;
  return opRuntime === wantRuntime;
}
