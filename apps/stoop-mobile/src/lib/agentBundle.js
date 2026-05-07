/**
 * agentBundle — wraps Stoop's `createNeighborhoodAgent` for one group.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 * The mobile app holds one `NeighborhoodAgent` bundle per joined
 * group (mirrors `apps/stoop/src/cluster.js`). This module is the
 * factory; ServiceContext owns the lifecycle (build / stop / list).
 *
 * Inputs:
 *   - identity (from KeychainVault)
 *   - groupId
 *   - localActor (the user's webid OR pubKey if no pod)
 *   - members list (initial roster — empty for a freshly-created group)
 *   - skills + posture (from the user's profile)
 *   - notifier / reveals (optional — passed through from the
 *     ServiceContext if available)
 *
 * Returns the bundle shape `createNeighborhoodAgent` returns:
 *   { agent, itemStore, members, skillMatch, notifier?, reveals?, muted }
 */

import { createNeighborhoodAgent } from '@canopy-app/stoop';
import { InternalBus, InternalTransport } from '@canopy/core';
import { SkillMatch }                      from '@canopy/skill-match';

/**
 * @param {object} args
 * @param {object} args.identity        from `loadOrGenerateIdentity`
 * @param {string} args.groupId
 * @param {string} args.localActor      e.g. `webid:${pubKey}` for local-only mode
 * @param {Array<object>} [args.members] initial peers; defaults to [] (lone-member group, populated as the user redeems / scans)
 * @param {string[]} [args.skills]
 * @param {Object<string, 'always'|'negotiable'|'never'>} [args.posture]
 * @param {object} [args.notifier]
 * @param {object} [args.reveals]
 * @param {object} [args.itemBackend]   pod-backed DataSource, or omitted for local-only
 * @param {string} [args.label]
 *
 * @returns {Promise<{
 *   agent: object,
 *   itemStore: object,
 *   members: object,
 *   skillMatch: object,
 *   notifier: object | null,
 *   reveals: object | null,
 *   muted: Set<string>,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function buildBundleForGroup({
  identity,
  groupId,
  localActor,
  members  = [],
  skills   = [],
  posture  = {},
  notifier,
  reveals,
  itemBackend,
  label,
} = {}) {
  if (!identity) throw new Error('buildBundleForGroup: identity required');
  if (typeof groupId !== 'string' || !groupId) {
    throw new Error('buildBundleForGroup: groupId required');
  }
  if (typeof localActor !== 'string' || !localActor) {
    throw new Error('buildBundleForGroup: localActor required');
  }

  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, identity.pubKey);

  const bundle = await createNeighborhoodAgent({
    identity,
    transport,
    label: label ?? `stoop-mobile:${groupId}`,
    skillMatch: {
      group:      groupId,
      localActor,
      peers:      members,
      skills,
      posture,
    },
    members,
    notifier,
    reveals,
    itemBackend,
  });

  // Start broadcasting / receiving on the skill-match channel.
  await bundle.skillMatch.start();

  // Compose a `stop()` that tears down the bundle in the right order.
  const stop = async () => {
    try { await bundle.skillMatch.stop?.(); } catch { /* swallow */ }
    try { await bundle.agent.stop?.();      } catch { /* swallow */ }
    try { bus.close?.();                     } catch { /* swallow */ }
  };

  return { ...bundle, stop };
}

/**
 * Default localActor for a fresh local-only mobile install — the
 * user's pubKey wrapped in a pseudo-webid.  Replaced by the real
 * pod webid after Phase 40.19's pod sign-in lands.
 */
export function defaultLocalActor(identity) {
  if (!identity?.pubKey) throw new Error('defaultLocalActor: identity.pubKey required');
  return `webid:local:${identity.pubKey}`;
}

/**
 * Relabel a bundle (typically the bootstrap bundle) onto a different
 * `groupId`.  Used during the no-groups → first-group transition so
 * the user's just-created group-rules + membership-code items + the
 * admin promotion in MemberMap survive without copying state.
 *
 * Stops the current SkillMatch and constructs a fresh one over the
 * SAME agent, attached to the new groupId. The bundle's `agent`,
 * `itemStore`, `members`, `chat`, `cache`, `metrics`, `reveals` etc.
 * are unchanged. Mutates `bundle.skillMatch` in place + returns the
 * (same) bundle.
 *
 * @param {object} args
 * @param {object} args.bundle      a previously-built bundle (e.g. bootstrap)
 * @param {string} args.newGroupId
 * @param {string} args.localActor
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {string[]} [args.skills]
 * @param {Object<string, 'always'|'negotiable'|'never'>} [args.posture]
 *
 * @returns {Promise<object>}  the same bundle, with `skillMatch` swapped
 */
export async function relabelBundleGroup({
  bundle, newGroupId, localActor,
  peers = [], skills = [], posture = {},
} = {}) {
  if (!bundle?.agent) throw new Error('relabelBundleGroup: bundle.agent required');
  if (typeof newGroupId !== 'string' || !newGroupId) {
    throw new Error('relabelBundleGroup: newGroupId required');
  }
  if (typeof localActor !== 'string' || !localActor) {
    throw new Error('relabelBundleGroup: localActor required');
  }

  // Stop the existing SkillMatch (on `_bootstrap` or whatever the old
  // group was). Best-effort — failures shouldn't block the transition.
  try { await bundle.skillMatch?.stop?.(); } catch { /* swallow */ }

  const skillMatch = new SkillMatch({
    agent:      bundle.agent,
    peers,
    group:      newGroupId,
    localActor,
    skills,
    posture,
  });
  await skillMatch.start();

  bundle.skillMatch = skillMatch;
  return bundle;
}
