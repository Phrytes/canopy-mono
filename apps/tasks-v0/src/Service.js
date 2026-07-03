/**
 * Service — §1b op→atom dispatch adapter for tasks-v0 (PLAN-capability-arc §1b · #65b "collapse the rest").
 *
 * The household pilot (`apps/canopy-chat/src/v2/householdApp.js`) exposed `callCapability(atom, noun, args)` over
 * a dissolved `CircleItemStore`. tasks-v0 is NOT dissolved — its ops are legacy `@canopy/core` `defineSkill`
 * handlers (`({parts, from, envelope}) => …`) whose structured args ride in a single `DataPart` and whose crew is
 * resolved from `parts` by a `bundleResolver`. So this adapter is a thin DataPart WRAPPER over the existing
 * `buildSkills`, adding NOTHING to the per-op logic:
 *   - `callSkill(opId, args, ctx)`   — invoke a skill by id with a synthetic `[DataPart({...args, crewId})]`.
 *   - `callCapability(atom, noun, …)` — resolve `(atom×noun)`→opId against the tasks manifest and dispatch,
 *     BESPOKE-OP-FIRST via `dispatchCapability`. `generic:{}` is passed deliberately: tasks-v0 has no
 *     `CircleItemStore`, and every declared tasks noun already has an implementing op, so the generic-CRUD
 *     fallback must never fire — an unimplemented `(atom×noun)` correctly reports `{ok:false, code:'unimplemented'}`.
 *
 * ── ARCHITECTURE GUARDRAIL (docs/architecture.md L60/L79) ──
 * `callSkill` is the DEFAULT-DENY security boundary. This service is the FUNCTIONALITY-side adapter (it runs the
 * app's ops); it is NOT to be wired as a live `(atom,noun)` entry that bypasses the capability gate. The live
 * interpreter path resolves `(atom,noun)`→opId at the GATED canopy-chat waist, then dispatches through the gated
 * `callSkill`. This adapter exists for tests + that future gated wiring — additive; the legacy dispatch is untouched.
 */
import { DataPart } from '@canopy/core';
import { dispatchCapability } from '@canopy/app-manifest';
import { buildSkills } from './skills/index.js';
import { tasksManifest } from '../manifest.js';

/**
 * @param {object}   deps
 * @param {(parts:Array, ctx?:object) => object|null} deps.bundleResolver  resolves the CrewState (per v2.8 single-agent).
 * @param {() => Iterable<object>} [deps.crewsProvider]                     dashboard/fallback crew iteration.
 * @param {object}   [deps.manifest]  defaults to the real tasks manifest (injectable for tests).
 */
export function createTasksService({ bundleResolver, crewsProvider, manifest = tasksManifest } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('createTasksService: bundleResolver(parts, ctx) required');
  }
  const byId = new Map(buildSkills({ bundleResolver, crewsProvider }).map((s) => [s.id, s.handler]));

  const service = {
    /** Invoke an op by id with structured args (the DataPart wrapper the legacy skills expect). */
    async callSkill(opId, args = {}, ctx = {}) {
      const handler = byId.get(opId);
      if (!handler) throw new Error(`tasksService.callSkill: unknown op "${opId}"`);
      // The crew is resolved from the DataPart (multiCrewResolver reads `crewId`/`_scope`); a singleCrewResolver
      // ignores it. crewId ≡ circleId (CIRCLE_ID_IS_CREW_ID_ALIAS).
      const scopeId = ctx.crewId ?? ctx.circleId ?? args.crewId;
      const data = scopeId != null ? { ...args, crewId: scopeId } : { ...args };
      return handler({ parts: [DataPart(data)], from: ctx.by ?? ctx.from, envelope: ctx.envelope ?? null, agent: ctx.agent });
    },

    /** Invoke a capability by (atom × noun); bespoke-op-first, no generic fallback (see file header). */
    async callCapability(atom, noun, args = {}, ctx = {}) {
      return dispatchCapability(
        manifest,
        { atom, noun, args },
        { dispatch: (opId, a) => service.callSkill(opId, a, ctx), generic: {}, ctx },
      );
    },
  };
  return service;
}
