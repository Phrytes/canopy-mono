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
 * @property {string[]}                                                    appOrigins
 * @property {string[]}                                                    warnings
 */

/**
 * Merge an array of `{manifest, callSkill?}` pairs into a canopy-chat
 * catalog.  Composes `@canopy/manifest-host` underneath.
 *
 * @param {Array<{ manifest: object, callSkill?: Function }>} sources
 * @returns {MergedCatalog}
 */
export function mergeManifests(sources) {
  if (!Array.isArray(sources)) {
    throw new TypeError('mergeManifests: sources must be an array');
  }

  const host        = createManifestHost();
  const warnings    = [];
  const opsById     = new Map();          // canopy-chat-shaped (unprefixed)
  const replyShape  = new Map();
  const appOrigins  = [];
  /** @type {Map<string, string>} command → first-mounting appId */
  const commandOwner = new Map();
  const commandMenu = [];                 // canopy-chat-shaped

  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') {
      warnings.push('mergeManifests: skipping source with no manifest');
      continue;
    }

    // Forward-fail loud on broken manifests with the legacy error
    // message canopy-chat callers already match against in tests.
    // manifest-host validates again internally; idempotent.
    const { ok, errors } = validateManifest(m);
    if (!ok) {
      throw new Error(
        `mergeManifests: invalid manifest from "${m.app}": ${JSON.stringify(errors)}`,
      );
    }

    // Skill-registry stub: renderChat runs inside host.mount() and
    // requires every operation to have an entry.  Real dispatch
    // happens via canopy-chat's own callSkill in main.js — not via
    // the stub.
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
      // host.mount throws on duplicate appId; surface as a warning
      // matching the legacy "op-id collision"-style message.
      if (/already mounted/.test(String(err?.message))) {
        warnings.push(
          `app collision: "${m.app}" mounted twice; v0.1 keeps the first.`,
        );
        continue;
      }
      throw err;
    }

    appOrigins.push(m.app);

    // Op-level merge: canopy-chat tracks each op's source app so
    // dispatch can route callSkill against the right agent.
    for (const op of m.operations ?? []) {
      // commandMenu: include only on first-mount-wins basis (collision
      // policy decided here; substrate would have reported the data
      // via compose().collisions, but we apply first-wins eagerly).
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

      if (opsById.has(op.id)) {
        warnings.push(
          `op-id collision: "${op.id}" declared by both "${opsById.get(op.id).appOrigin}" and "${m.app}"; v0.1 keeps the first.`,
        );
        continue;
      }
      opsById.set(op.id, { op, appOrigin: m.app });

      // Q28 reply-shape lookup comes from the substrate's renderChat
      // output (mounted.rendered.replyShapeFor).
      const shape = mounted.rendered.replyShapeFor?.(op.id);
      if (shape) replyShape.set(op.id, shape);
    }
  }

  return {
    commandMenu,
    opsById,
    replyShapeFor: (opId) => replyShape.get(opId),
    appOrigins,
    warnings,
  };
}
