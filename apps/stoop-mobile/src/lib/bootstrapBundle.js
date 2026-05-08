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

import {
  createNeighborhoodAgent,
  wireGroupBroadcastMirror,
} from '@canopy-app/stoop';
import { defaultLocalActor, buildMeshAgent } from './agentBundle.js';

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
export async function buildBootstrapBundle({ identity, label, relayUrl } = {}) {
  if (!identity) throw new Error('buildBootstrapBundle: identity required');

  const localActor = defaultLocalActor(identity);

  // Use the same mesh-capable agent as a real group bundle. The
  // user can scan / be scanned during onboarding (relabel keeps the
  // SAME agent), so peer-discovery has to be live from boot.
  const meshAgent = await buildMeshAgent({
    identity,
    label: label ?? 'stoop-mobile:_bootstrap',
    peerGraphPrefix: 'stoop:peers:_bootstrap:',
    relayUrl,
  });

  const bundle = await createNeighborhoodAgent({
    identity,
    agent: meshAgent,
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

  // ItemStore → agent event bridge (mirror of buildBundleForGroup):
  // FeedScreen et al. listen on agent.on('item-arrive') to know
  // when to refresh.  Without this bridge, items written by the
  // mirror or local skill calls don't trigger any UI update.
  const _bridgeItemArrive = (item) => {
    try { bundle.agent.emit?.('item-arrive', item); } catch { /* swallow */ }
  };
  bundle.itemStore.on?.('item-added',     _bridgeItemArrive);
  bundle.itemStore.on?.('item-updated',   _bridgeItemArrive);
  bundle.itemStore.on?.('item-completed', _bridgeItemArrive);

  // Cross-device post replication mirror — same as a real group
  // bundle.  On `_bootstrap` it's a no-op (no peers post there),
  // but the relabel path swaps it onto the real groupId where it
  // actually does work.
  const mirror = await wireGroupBroadcastMirror({
    agent:          bundle.agent,
    itemStore:      bundle.itemStore,
    group:          BOOTSTRAP_GROUP_ID,
    peers:          [],
    evictionRoster: bundle.evictionRoster ?? null,
  });
  bundle.mirror = mirror;

  // Bridge mDNS → SkillMatch + mirror (mirror of buildBundleForGroup).
  // Bootstrap's SkillMatch is on the `_bootstrap` topic; cross-device
  // discovery still happens, but broadcasts on `_bootstrap` reach
  // nobody (peers only subscribe once they share a real group).
  // After relabel to a real group, the same agent + peers carry
  // forward and the new group's SkillMatch + mirror pick them up.
  const _onAgentPeer = ({ address, pubKey }) => {
    const pk = pubKey ?? address;
    if (!pk || typeof pk !== 'string') return;
    if (pk.includes(':')) return;
    if (pk === meshAgent.address) return;
    try { bundle.skillMatch?.addPeer?.({ pubKey: pk }); } catch { /* best effort */ }
    bundle.mirror?.addPeer?.(pk).catch(() => { /* swallow */ });
  };
  meshAgent.on('peer', _onAgentPeer);

  // SkillMatch.start() with zero peers does no subscribe work but
  // still flips the `started` flag so broadcasts don't throw.
  await bundle.skillMatch.start();

  const stop = async () => {
    try { meshAgent.off('peer', _onAgentPeer);   } catch { /* swallow */ }
    try { await bundle.mirror?.stop?.();         } catch { /* swallow */ }
    try { await bundle.skillMatch.stop?.();      } catch { /* swallow */ }
    try { await bundle.agent.stop?.();           } catch { /* swallow */ }
  };

  return { ...bundle, isBootstrap: true, stop };
}
