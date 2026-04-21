/**
 * createMeshAgent — opinionated factory for a mesh-capable Agent on React Native.
 *
 * One call bundles:
 *   • Permissions request (BLE + location on Android, iOS short-circuit)
 *   • Identity restore-or-generate via KeychainVault (default service: 'mesh')
 *   • BLE, mDNS, Relay transports wired as secondaries; OfflineTransport as
 *     safe primary fallback so the agent always reaches `ready`
 *   • Routing strategy that prefers BLE → mDNS → relay, and falls back to
 *     OfflineTransport (clean error) for unreachable peers
 *   • PeerGraph backed by AsyncStorageAdapter (persisted across restarts)
 *   • AgentConfig with `policy.allowRelayFor = 'authenticated'`
 *   • Automatic `agent.on('peer')` upsert keeping PeerGraph in sync with
 *     inbound hellos (hops:0 + via:null, so stale indirect records don't
 *     override direct ones)
 *
 * What the factory deliberately does NOT do:
 *   • Register application skills (receive-message, etc.) — that's the app's
 *     domain. Call agent.register(...) after the factory returns.
 *   • Install peer-discovered handlers — opt in via `agent.enableAutoHello()`
 *     (Group R). Apps that want selective hello can still listen by hand.
 *   • Enable the relay-forward skill — opt in via `agent.enableRelayForward()`.
 *   • Start the discovery loops — opt in via `agent.startDiscovery()`.
 *
 * See EXTRACTION-PLAN.md §7 Group Q + §2 for full rationale.
 */
import {
  Agent,
  AgentConfig,
  AgentIdentity,
  OfflineTransport,
  PeerGraph,
  RelayTransport,
} from '@canopy/core';

import { KeychainVault }       from './identity/KeychainVault.js';
import { AsyncStorageAdapter } from './storage/AsyncStorageAdapter.js';
import { MdnsTransport }       from './transport/MdnsTransport.js';
import { BleTransport }        from './transport/BleTransport.js';
import { requestMeshPermissions } from './permissions.js';

/**
 * @param {object}  [opts]
 * @param {string}  [opts.label]              — display label on the agent
 * @param {string}  [opts.relayUrl]           — ws:// or wss:// URL of a relay server
 * @param {object}  [opts.vault]              — custom Vault; defaults to KeychainVault({ service: 'mesh' })
 * @param {object}  [opts.transports]         — { ble, mdns, relay } booleans, all default true
 * @param {string}  [opts.peerGraphPrefix]    — AsyncStorage key prefix (default 'mesh:peers:')
 * @param {number}  [opts.mdnsTimeoutMs]      — how long to wait for mDNS pre-connect (default 6000)
 * @param {object}  [opts.configOverrides]    — merged into AgentConfig overrides
 * @returns {Promise<import('@canopy/core').Agent>}
 */
export async function createMeshAgent(opts = {}) {
  const {
    label,
    relayUrl,
    vault,
    transports:       transportEnabled = {},
    peerGraphPrefix   = 'mesh:peers:',
    mdnsTimeoutMs     = 6_000,
    configOverrides,
  } = opts;

  const enableBle   = transportEnabled.ble   !== false;
  const enableMdns  = transportEnabled.mdns  !== false;
  const enableRelay = transportEnabled.relay !== false;

  // ── Permissions (before any native transport is instantiated) ──────────────
  const perms = await requestMeshPermissions();

  // ── Identity ───────────────────────────────────────────────────────────────
  const resolvedVault = vault ?? new KeychainVault({ service: 'mesh' });
  let identity;
  try {
    identity = await AgentIdentity.restore(resolvedVault);
  } catch {
    identity = await AgentIdentity.generate(resolvedVault);
  }

  // ── Transports (each wrapped — one failure doesn't abort boot) ─────────────
  let mdns = null;
  if (enableMdns && MdnsTransport.isAvailable()) {
    try {
      mdns = new MdnsTransport({
        identity,
        hostname: `dw-${identity.pubKey.slice(0, 8)}`,
      });
    } catch (e) {
      console.warn('[createMeshAgent] MdnsTransport init failed:', e?.message);
    }
  }

  let ble = null;
  if (enableBle && perms.ble) {
    try {
      ble = new BleTransport({ identity, advertise: true, scan: true });
    } catch (e) {
      console.warn('[createMeshAgent] BleTransport init failed:', e?.message);
    }
  }

  let relay = null;
  if (enableRelay && relayUrl) {
    try {
      relay = new RelayTransport({ relayUrl, identity });
    } catch (e) {
      console.warn('[createMeshAgent] RelayTransport init failed:', e?.message);
    }
  }

  // Pre-connect mDNS so we know the interface actually works.  WiFi off →
  // the 6 s internal timeout rejects; we nullify mdns so it isn't retried
  // as a fatal primary during agent.start().
  if (mdns) {
    try {
      await _withTimeout(mdns.connect(), mdnsTimeoutMs, 'mDNS pre-connect');
    } catch (e) {
      console.warn('[createMeshAgent] mDNS disabled:', e?.message);
      mdns = null;
    }
  }

  // ── PeerGraph (persisted) ──────────────────────────────────────────────────
  const peers = new PeerGraph({
    storageBackend: new AsyncStorageAdapter({ prefix: peerGraphPrefix }),
  });

  // ── Config ─────────────────────────────────────────────────────────────────
  const config = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor: 'authenticated' },
      ...(configOverrides ?? {}),
    },
  });

  // ── Primary + routing ──────────────────────────────────────────────────────
  const offline = new OfflineTransport({ identity });
  const primary = mdns ?? offline;

  const routing = {
    selectTransport: (peerId) => {
      if (typeof peerId === 'string' && peerId.includes(':')) {
        return { transport: ble };                    // BLE MAC → initial hello
      }
      if (ble?._hasPeer?.(peerId))  return { transport: ble };
      if (mdns?._hasPeer?.(peerId)) return { transport: mdns };
      if (relay)                    return { transport: relay };
      return { transport: offline };                   // fails cleanly
    },
  };

  // ── Agent ──────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity,
    transport: primary,
    peers,
    config,
    routing,
    label:     label ?? null,
  });

  if (ble)   agent.addTransport('ble',   ble);
  if (relay) agent.addTransport('relay', relay);

  // ── Keep PeerGraph in sync with inbound hellos ─────────────────────────────
  // An inbound HI means we now have a DIRECT path to this peer. Explicitly
  // upgrade hops:0/via:null so a stale indirect record doesn't survive the
  // spread-merge in PeerGraph.upsert and send us bridging through the wrong
  // peer. (Bug hunted down in session 2026-04-20; see EXTRACTION-PLAN.md §5.)
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
    }).catch(() => {});
  });

  await agent.start();
  return agent;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )),
  ]);
}
