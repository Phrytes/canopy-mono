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
import {
  Agent, AgentConfig, FallbackTable, InternalBus, InternalTransport,
  PeerGraph, RelayTransport, RoutingStrategy,
} from '@canopy/core';
import { SkillMatch }                      from '@canopy/skill-match';
// Subpath imports — pulling from `@canopy/react-native`'s barrel
// would re-evaluate KeychainVault, whose `react-native-keychain` TS
// import vitest can't parse.  Subpath bypass.
import { MdnsTransport }       from '@canopy/react-native/src/transport/MdnsTransport.js';
import { AsyncStorageAdapter } from '@canopy/react-native/src/storage/AsyncStorageAdapter.js';

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
  /**
   * Local-only role hint from the persisted groupRegistry entry.
   * When set (e.g. `'admin'`), seeded into the bundle's MemberMap
   * after construction so server-side admin gates (in skills like
   * `getCurrentMembershipCode`, `rotateMyGroupCode`) clear after a
   * cold start.  The bundle's MemberMap is in-memory on mobile (no
   * persistPath wired) so each restart wipes role info — without
   * this seed, the user "loses admin" on relaunch.
   */
  localRole,
  notifier,
  reveals,
  itemBackend,
  label,
  /** Optional ws://… or wss://… URL for the broker transport. */
  relayUrl,
} = {}) {
  if (!identity) throw new Error('buildBundleForGroup: identity required');
  if (typeof groupId !== 'string' || !groupId) {
    throw new Error('buildBundleForGroup: groupId required');
  }
  if (typeof localActor !== 'string' || !localActor) {
    throw new Error('buildBundleForGroup: localActor required');
  }

  // Build a multi-transport agent: InternalTransport as the primary
  // (handles self-loop for `agent.invoke(self, ...)` — Stoop's whole
  // UI dispatches that way) plus mDNS as a named transport so two
  // phones on the same Wi-Fi can discover + reach each other.
  const meshAgent = await buildMeshAgent({
    identity,
    label: label ?? `stoop-mobile:${groupId}`,
    peerGraphPrefix: `stoop:peers:${groupId}:`,
    relayUrl,
  });

  const bundle = await createNeighborhoodAgent({
    identity,
    agent: meshAgent,
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

  // Bridge mDNS peer-discovered → SkillMatch.addPeer so when the
  // other phone advertises itself the SkillMatch subscribes to it
  // and broadcasts reach.  We add only stable pubkeys (skip BLE MAC
  // shaped strings — colon-containing — to match createMeshAgent's
  // convention) and skip self.
  const _onAgentPeer = ({ address, pubKey }) => {
    const pk = pubKey ?? address;
    if (!pk || typeof pk !== 'string') return;
    if (pk.includes(':')) return;          // BLE MAC, not a pubkey
    if (pk === meshAgent.address) return;  // self
    try { bundle.skillMatch?.addPeer?.({ pubKey: pk }); } catch { /* best effort */ }
  };
  meshAgent.on('peer', _onAgentPeer);

  // Seed the local actor's role into MemberMap when the registry
  // entry says we're admin/coordinator. The bundle factory only sets
  // pubKey + stableId on the local actor, never role — that arrives
  // via createGroupV2's `addMember(..., role: 'admin')`, but on a
  // cold start (mobile cache is in-memory) the addMember call has
  // already been "lost" to the empty cache so we need to replay it.
  //
  // **Keying:** stoop skills receive `from = envelope._from = pubKey`
  // (the agent's address, NOT the localActor webid). createGroupV2
  // matches that by indexing the admin entry under `webid = from`
  // (i.e. webid = pubKey). For the admin gate to clear after cold
  // start, the seeded entry MUST live under the same key.
  if (localRole === 'admin' || localRole === 'coordinator') {
    try {
      const pubKey = bundle.agent?.address ?? identity.pubKey;
      if (pubKey && bundle.members?.addMember) {
        const existing = await bundle.members.resolveByWebid(pubKey);
        await bundle.members.addMember({
          ...(existing ?? { webid: pubKey }),
          pubKey,
          role: localRole,
        });
      }
    } catch { /* best effort — admin gate skills will surface a clearer error if this matters */ }
  }

  // Start broadcasting / receiving on the skill-match channel.
  await bundle.skillMatch.start();

  // Compose a `stop()` that tears down the bundle in the right order.
  // agent.stop() disconnects every named transport (mDNS, internal),
  // so we don't need a separate bus.close() here — the InternalBus
  // is held inside the InternalTransport instance and goes away with it.
  const stop = async () => {
    try { meshAgent.off('peer', _onAgentPeer);   } catch { /* swallow */ }
    try { await bundle.skillMatch.stop?.();      } catch { /* swallow */ }
    try { await bundle.agent.stop?.();           } catch { /* swallow */ }
  };

  return { ...bundle, stop };
}

/**
 * Build a multi-transport `core.Agent` for one Stoop bundle.
 *
 * Phase 40.23 follow-up (2026-05-08): wires mDNS so two phones on the
 * same Wi-Fi can discover each other.  Architecture:
 *
 *   - **Primary** (default slot): `InternalTransport` over a private
 *     `InternalBus`.  Required for self-loop — Stoop's UI dispatches
 *     skills via `agent.invoke(self, ...)` and the InternalBus is the
 *     only transport that delivers `to === from`.
 *   - **Named** (mdns slot): `MdnsTransport`.  Routing prefers it for
 *     any peer it can reach (`canReach()` returns true for peers
 *     advertised on the LAN).  When mDNS doesn't know the peer,
 *     RoutingStrategy returns null, Agent falls back to the primary
 *     InternalTransport — which silently drops sends to non-self
 *     peers (the right behaviour: SkillMatch only addPeer's known
 *     peers, so a fall-through to internal means the broadcast is a
 *     no-op rather than an error).
 *
 * BLE + relay are deliberately omitted for now — BLE adds permission
 * complexity for the simple PoC and relay needs a server URL.
 * Plumbed-in extension points are obvious if we want them later.
 */
export async function buildMeshAgent({ identity, label, peerGraphPrefix, relayUrl }) {
  const bus       = new InternalBus();
  const internal  = new InternalTransport(bus, identity.pubKey);

  const peers = new PeerGraph({
    storageBackend: new AsyncStorageAdapter({ prefix: peerGraphPrefix }),
  });

  const fallbackTable = new FallbackTable();
  const routing = new RoutingStrategy({
    transports:    new Map(),
    peerGraph:     peers,
    fallbackTable,
  });

  const config = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor: 'authenticated' },
    },
  });

  const agent = new Agent({
    identity, transport: internal, peers, config, routing,
    label: label ?? null,
  });

  // mDNS: best-effort. If the native module isn't available
  // (e.g. running in Expo Go on iOS) skip it and continue with the
  // internal-only setup — the bundle still works for in-process use.
  try {
    const mdnsAvailable = !!MdnsTransport?.isAvailable?.();
    if (!mdnsAvailable) {
      console.warn('[agentBundle] MdnsTransport native module unavailable — running internal-only. ' +
        'If you expected cross-device discovery: run `npx expo run:android` to rebuild the dev client ' +
        'with @canopy/react-native\'s autolinked MdnsPackage.');
    }
    if (mdnsAvailable) {
      const mdns = new MdnsTransport({
        identity,
        hostname: `stoop-${identity.pubKey.slice(0, 8)}`,
      });
      // Pre-connect with a short timeout so a Wi-Fi-off install
      // doesn't make the first bundle build wait forever.
      await Promise.race([
        mdns.connect(),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('mdns pre-connect timeout')),
          6000,
        )),
      ]).catch((err) => {
        console.warn('[agentBundle] mDNS pre-connect failed:', err?.message ?? err);
        throw err;
      });
      agent.addTransport('mdns', mdns);

      // mDNS surfaces a peer-discovered event with the raw pubkey.
      // Mirror createMeshAgent's pattern: upsert hops:0/via:null so
      // a stale gossip-cached indirect record can't survive and
      // bridge through a non-existent relay.
      mdns.on('peer-discovered', (peerAddress) => {
        if (!peerAddress || typeof peerAddress !== 'string') return;
        if (peerAddress === identity.pubKey) return;
        peers.upsert({
          type:          'native',
          pubKey:        peerAddress,
          reachable:     true,
          hops:          0,
          via:           null,
          lastSeen:      Date.now(),
          discoveredVia: 'mdns-peer-discovered',
        }).catch(() => { /* swallow */ });
      });
    }
  } catch (err) {
    console.warn('[agentBundle] mDNS init failed; using internal-only:', err?.message ?? err);
  }

  // Relay (Path B): when a relay URL is configured, plumb a
  // `RelayTransport` so two devices that can't see each other on
  // the LAN (different Wi-Fi, cellular, mDNS-blocked router) can
  // still reach each other through a shared broker.  Pure WebSocket,
  // no native module — works in Expo Go.  Run a local relay with
  // `npx @canopy/relay` (port 8787 by default).
  if (typeof relayUrl === 'string' && relayUrl.length > 0) {
    try {
      const relay = new RelayTransport({ relayUrl, identity });
      agent.addTransport('relay', relay);

      relay.on('peer-discovered', (peerAddress) => {
        if (!peerAddress || typeof peerAddress !== 'string') return;
        if (peerAddress === identity.pubKey) return;
        peers.upsert({
          type:          'native',
          pubKey:        peerAddress,
          reachable:     true,
          hops:          0,
          via:           null,
          lastSeen:      Date.now(),
          discoveredVia: 'relay-peer-discovered',
        }).catch(() => { /* swallow */ });
      });
    } catch (err) {
      console.warn('[agentBundle] RelayTransport init failed:', err?.message ?? err);
    }
  }

  // Auto-hello + discovery so peers exchange HI handshakes after
  // mDNS announces them. Without this, mDNS would discover the
  // other phone's address but the SecurityLayer would still reject
  // sends with UNKNOWN_RECIPIENT.
  try { agent.enableAutoHello?.({ pullPeers: true }); } catch { /* non-fatal */ }
  try { agent.startDiscovery?.({ gossipIntervalMs: 60_000 }); } catch { /* non-fatal */ }

  // PeerGraph upgrades on direct hello — keep it accurate.
  agent.on('peer', ({ address, pubKey, label: peerLabel, ack }) => {
    if (!pubKey) return;
    peers.upsert({
      type:          'native',
      pubKey,
      label:         peerLabel ?? null,
      reachable:     true,
      hops:          0,
      via:           null,
      lastSeen:      Date.now(),
      discoveredVia: ack ? 'hello-ack' : 'hello-inbound',
      transports:    { default: { address, lastSeen: Date.now() } },
    }).catch(() => { /* swallow */ });
  });

  return agent;
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
  /** Same role-seed as buildBundleForGroup — see its JSDoc. */
  localRole,
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

  // Seed admin role on the relabel path (mirror of buildBundleForGroup).
  // See the JSDoc on the seed in buildBundleForGroup for the keying
  // rationale — entry MUST be under webid=pubKey to match `from` in
  // the skill handler.
  if (localRole === 'admin' || localRole === 'coordinator') {
    try {
      const pubKey = bundle.agent?.address ?? bundle.agent?.identity?.pubKey;
      if (pubKey && bundle.members?.addMember) {
        const existing = await bundle.members.resolveByWebid(pubKey);
        await bundle.members.addMember({
          ...(existing ?? { webid: pubKey }),
          pubKey,
          role: localRole,
        });
      }
    } catch { /* best effort */ }
  }

  return bundle;
}
