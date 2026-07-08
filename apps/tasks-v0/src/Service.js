/**
 * Service — §1b op→atom dispatch adapter for tasks-v0 (PLAN-capability-arc §1b · #65b "collapse the rest").
 *
 * The household pilot (`apps/canopy-chat/src/v2/householdApp.js`) exposed `callCapability(atom, noun, args)` over
 * a dissolved `CircleItemStore`. tasks-v0 is NOT dissolved — its ops are legacy `@canopy/core` `defineSkill`
 * handlers (`({parts, from, envelope}) => …`) whose structured args ride in a single `DataPart` and whose circle is
 * resolved from `parts` by a `bundleResolver`. So this adapter is a thin DataPart WRAPPER over the existing
 * `buildSkills`, adding NOTHING to the per-op logic:
 *   - `callSkill(opId, args, ctx)`   — invoke a skill by id with a synthetic `[DataPart({...args, circleId})]`.
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
import { buildSkills, TASK_CORES } from './skills/index.js';
import { tasksManifest } from '../manifest.js';

/**
 * @param {object}   deps
 * @param {(parts:Array, ctx?:object) => object|null} deps.bundleResolver  resolves the CircleState (per v2.8 single-agent).
 * @param {() => Iterable<object>} [deps.circlesProvider]                     dashboard/fallback circle iteration.
 * @param {object}   [deps.manifest]  defaults to the real tasks manifest (injectable for tests).
 */
export function createTasksService({ bundleResolver, circlesProvider, manifest = tasksManifest } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('createTasksService: bundleResolver(parts, ctx) required');
  }
  const byId = new Map(buildSkills({ bundleResolver, circlesProvider }).map((s) => [s.id, s.handler]));

  const service = {
    /**
     * Invoke an op by id with structured args — the LOCAL route (decision #5).
     *
     * Workstream B: for an op that has a pure `(circle, args, ctx)` core in
     * `TASK_CORES`, we call that core DIRECTLY over the resolved per-circle
     * store — NOT by faking a wire message. The circle is resolved from the
     * decoded args via `bundleResolver(null, { …, args })` (the resolver reads
     * `args.circleId`/`_scope` off `ctx.args`), so no synthetic `[DataPart(args)]`
     * is built just to have `wireSkill` decode it straight back. The core's
     * return value is the SAME object the wire route's handler yields, so
     * `callCapability`/callers see identical shapes.
     *
     * Ops WITHOUT a pure core (hand-written `defineSkill`s — editTask,
     * reassignTask, provisionMyCircle, the pod-sign-in family, …) keep the
     * legacy handler path: their contract is the `({parts, from, envelope})`
     * signature, so we hand them the single `DataPart` they read.
     */
    async callSkill(opId, args = {}, ctx = {}) {
      const from     = ctx.by ?? ctx.from;
      const envelope = ctx.envelope ?? null;
      // circleId ≡ crewId (CIRCLE_ID_IS_CREW_ID_ALIAS); ctx wins, then args.
      const scopeId  = ctx.circleId ?? args.circleId;
      const callArgs = scopeId != null ? { ...args, circleId: scopeId } : { ...args };

      const core = TASK_CORES[opId];
      if (core) {
        // Direct core call — resolve the store from args (no synthetic DataPart).
        const circle   = bundleResolver(null, { envelope, from, args: callArgs });
        const coreCtx  = { from, envelope, agent: ctx.agent, actorDisplayName: ctx.actorDisplayName };
        return core(circle, callArgs, coreCtx);
      }

      // Hand-written (non-core) op → the legacy DataPart handler path.
      const handler = byId.get(opId);
      if (!handler) throw new Error(`tasksService.callSkill: unknown op "${opId}"`);
      return handler({ parts: [DataPart(callArgs)], from, envelope, agent: ctx.agent });
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
