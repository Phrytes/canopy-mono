/**
 * canopy-chat-mobile — in-process agent bundle.
 *
 * Mirrors apps/canopy-chat/src/web/realAgent.js's composition
 * pattern: three (eventually four) real app agents share one
 * InternalBus + LocalStore, exposed behind a single `callSkill`
 * dispatcher.  Portable: zero RN, zero DOM.
 *
 * V0 (#222 skeleton):
 *   - Composes ONLY the manifests (renderMobile-ready) + a
 *     stubbed dispatcher.  Real per-agent boot lives behind
 *     adapter seams that the next slice fills.
 *
 * V1 (per #225.1):
 *   - When realAgent.js's portable half is lifted from
 *     apps/canopy-chat/src/web/, this file consumes that lifted
 *     factory directly — no re-implementation.
 *
 * V2 (per #223 NKN-on-RN):
 *   - Wires the RN NKN transport so cross-device mesh flows work
 *     on Android.  Until then, callSkill returns {ok:false,
 *     error:'mesh transport pending'} for any cross-instance op.
 */
import { composeManifests } from './composeManifests.js';

/**
 * Boot a minimal canopy-chat-mobile agent bundle.
 *
 * @param {object} [opts]
 * @param {object} [opts.householdManifest]  optional real household
 *                                           manifest to merge in
 * @param {(opId: string, args: object) => Promise<object>} [opts.skillStub]
 *           optional stub for callSkill — used by tests + the V0
 *           skeleton before per-agent boot is wired.  Defaults to a
 *           handler that returns `{ok: false, error: 'agent-not-booted'}`.
 *
 * @returns {Promise<{catalog, callSkill, dispose}>}
 */
export async function bootAgentBundle(opts = {}) {
  const catalog = composeManifests({ householdManifest: opts.householdManifest });

  // The stub returns a clear error so callers can detect "skeleton
  // mode" vs. "real agents wired".  When #225.1 lifts realAgent's
  // portable half, this default flips to the real dispatcher.
  const defaultSkill = async (opId) => ({
    ok:    false,
    error: 'agent-not-booted',
    note:  `canopy-chat-mobile V0 skeleton; skill "${opId}" requires per-agent boot (see #225.1).`,
  });
  const skillStub = typeof opts.skillStub === 'function' ? opts.skillStub : defaultSkill;

  const callSkill = async (appOrigin, opId, args) => {
    // V0: no app-routing yet — just delegate to the stub.  V1
    // restores canopy-chat web's routing table (appOrigin →
    // tasksCrew | stoopAgent | folioAgent | hostAgent).
    return skillStub(opId, args ?? {}, { appOrigin });
  };

  return {
    catalog,
    callSkill,
    dispose: async () => { /* V1: tear down agents */ },
  };
}
