/**
 * bootstrapBundle — pre-group agent for the no-groups state.
 *
 * Stoop V3 Phase 40.23 follow-up (2026-05-08).
 *
 * **The chicken-and-egg:** Stoop's `createNeighborhoodAgent` factory
 * is per-group — it requires `skillMatch.group` to be set, and the
 * skill bus is registered under that group's topic prefix. Onboarding
 * flows (Welcome → CreateGroup, OnboardScan, OnboardRestore) need
 * SOME bundle to dispatch `createGroupV2` / `redeemInvite` /
 * `restoreFromMnemonic` against, but the user has no group yet.
 *
 * Solution: build a bundle with a **placeholder** `groupId: '_bootstrap'`
 * + zero peers. SkillMatch.start() is a no-op (no peers to subscribe
 * to); broadcasts go nowhere (fine — the user can't receive yet either).
 * The full Stoop skill bus IS registered, so the onboarding skills
 * resolve cleanly.
 *
 * **State preservation across the transition:** when the user creates
 * a real group, ServiceContext.addGroup spins up a real bundle with
 * the same `itemStore` + `members` instances (via `seedFromBundle`)
 * so the just-written group-rules + membership-code items don't
 * evaporate. The `_bootstrap` skillMatch is torn down; the agent
 * + cache + roster carry forward.
 */

import { createNeighborhoodAgent } from '@canopy-app/stoop';
import { InternalBus, InternalTransport } from '@canopy/core';
import { defaultLocalActor }       from './agentBundle.js';

export const BOOTSTRAP_GROUP_ID = '_bootstrap';

/**
 * @param {object} args
 * @param {object} args.identity   from `loadOrGenerateIdentity`
 * @param {string} [args.label]
 * @returns {Promise<{
 *   agent: object,
 *   itemStore: object,
 *   members: object,
 *   skillMatch: object,
 *   notifier: object | null,
 *   reveals: object | null,
 *   muted: Set<string>,
 *   isBootstrap: true,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function buildBootstrapBundle({ identity, label } = {}) {
  if (!identity) throw new Error('buildBootstrapBundle: identity required');

  const localActor = defaultLocalActor(identity);
  const bus        = new InternalBus();
  const transport  = new InternalTransport(bus, identity.pubKey);

  const bundle = await createNeighborhoodAgent({
    identity,
    transport,
    label: label ?? 'stoop-mobile:_bootstrap',
    skillMatch: {
      group:      BOOTSTRAP_GROUP_ID,
      localActor,
      peers:      [],   // no peers → SkillMatch.start() is a no-op
      skills:     [],
      posture:    {},
    },
    members: [],
  });

  // SkillMatch.start() with zero peers does no subscribe work but
  // still flips the `started` flag so broadcasts don't throw.
  await bundle.skillMatch.start();

  const stop = async () => {
    try { await bundle.skillMatch.stop?.(); } catch { /* swallow */ }
    try { await bundle.agent.stop?.();      } catch { /* swallow */ }
    try { bus.close?.();                     } catch { /* swallow */ }
  };

  return { ...bundle, isBootstrap: true, stop };
}
