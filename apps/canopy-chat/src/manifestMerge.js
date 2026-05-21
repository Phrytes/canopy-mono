/**
 * canopy-chat — manifest merge.
 *
 * At boot, the chat shell loads multiple apps' manifests and merges
 * them into a single catalog the parser + router consume.  v0.1
 * builds the minimum the parser needs: a flat `commandMenu` from
 * all manifests' slash-declaring ops + an `opsById` map that records
 * each op's owning app (for the router's dispatch step).
 *
 * Op-prefix-on-collision (per v0.4 design — flat names when unique,
 * `<app>/<op>` when ≥2 apps declare the same id) is NOT in scope for
 * v0.1; v0.1 ships flat names + warns on collision.  v0.4 lands the
 * prefix logic.
 *
 * Q28 reply-shape lookup is exposed per-app via the underlying
 * `renderChat.replyShapeFor`, surfaced through a single
 * `replyShapeFor(opId)` on the merged catalog.
 *
 * Phase v0.1 sub-slice 1.5 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { renderChat, validateManifest } from '@canopy/app-manifest';

/**
 * @typedef {object} MergedCatalog
 * @property {Array<{ command: string, opId: string, appOrigin: string }>} commandMenu
 * @property {Map<string, { op: object, appOrigin: string }>}              opsById
 * @property {(opId: string) => string | undefined}                        replyShapeFor
 * @property {string[]}                                                    appOrigins
 * @property {string[]}                                                    warnings
 */

/**
 * Merge an array of `{manifest, callSkill}` pairs into one catalog.
 *
 * For v0.1 we only need read-only manifest information (commandMenu,
 * opsById, replyShapeFor).  The `callSkill` plumbing lives on the
 * pairs so a future phase can wire dispatch through the merged
 * catalog without changing this API.
 *
 * @param {Array<{ manifest: object, callSkill?: Function }>} sources
 * @returns {MergedCatalog}
 */
export function mergeManifests(sources) {
  if (!Array.isArray(sources)) {
    throw new TypeError('mergeManifests: sources must be an array');
  }

  const warnings    = [];
  const commandMenu = [];
  const opsById     = new Map();        // opId → {op, appOrigin}
  const replyShape  = new Map();        // opId → declared chat reply shape
  const appOrigins  = [];
  const commandSeen = new Map();        // command → first appOrigin that declared it

  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') {
      warnings.push('mergeManifests: skipping source with no manifest');
      continue;
    }

    // Forward-fail loud on broken manifests — the chat shell can't
    // safely dispatch against an invalid catalog.  Caller may catch.
    const { ok, errors } = validateManifest(m);
    if (!ok) {
      throw new Error(
        `mergeManifests: invalid manifest from "${m.app}": ${JSON.stringify(errors)}`,
      );
    }

    appOrigins.push(m.app);

    // Build per-app chat-side projection (v0.1 only needs commandMenu
    // + replyShapeFor; toolCatalog/handlers are LLM-shaped and land
    // in v0.8).  renderChat needs a skillRegistry stub so its strict
    // mode is happy; we don't actually invoke it during merge.
    const stub = {};
    for (const op of m.operations ?? []) {
      stub[op.id] = async () => ({ replies: [], stateUpdates: [] });
    }
    const projection = renderChat(m, {
      skillRegistry: stub,
      toSkillCtx:    (c) => c,
    });

    for (const entry of projection.commandMenu ?? []) {
      const owned = commandSeen.get(entry.command);
      if (owned && owned !== m.app) {
        // v0.1 — flat names; warn on collision.  v0.4 will replace
        // this with prefix-on-collision logic.
        warnings.push(
          `slash collision: "${entry.command}" declared by both "${owned}" and "${m.app}"; v0.1 keeps the first.`,
        );
        continue;
      }
      commandSeen.set(entry.command, m.app);
      // Map command back to opId via the manifest (renderChat's
      // commandMenu carries `command` + `description` but not `opId`).
      // Re-walk operations to find the owning op.
      const op = (m.operations ?? []).find(
        (o) => o?.surfaces?.slash?.command === entry.command,
      );
      if (!op) continue;          // defensive: should never happen post-validate
      commandMenu.push({
        command:   entry.command,
        opId:      op.id,
        appOrigin: m.app,
      });
    }

    for (const op of m.operations ?? []) {
      if (opsById.has(op.id)) {
        warnings.push(
          `op-id collision: "${op.id}" declared by both "${opsById.get(op.id).appOrigin}" and "${m.app}"; v0.1 keeps the first.`,
        );
        continue;
      }
      opsById.set(op.id, { op, appOrigin: m.app });
    }

    // Q28 reply shapes — fold per-app into the merged map.
    for (const op of m.operations ?? []) {
      const shape = projection.replyShapeFor?.(op.id);
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
