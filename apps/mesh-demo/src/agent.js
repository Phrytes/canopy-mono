/**
 * createAgent — Group A: agent factory.
 *
 * Constructs and starts the agent with:
 *   - KeychainVault (iOS Secure Enclave / Android Keystore)
 *   - MdnsTransport as primary (WiFi/LAN peer discovery)
 *   - BleTransport as secondary (Bluetooth LE)
 *   - PeerGraph backed by AsyncStorage (persists across app restarts)
 *   - AgentConfig with cooperative relay enabled for trusted peers
 *
 * What lives here vs the packages:
 *   PACKAGES: transport logic, crypto, protocol, PeerGraph structure
 *   THIS FILE: which transports to combine, config values, inbound hello wiring
 *
 * The inbound hello → PeerGraph upsert (agent.on('peer', ...)) is intentionally
 * kept here rather than inside Agent._dispatch, so the app controls which peer
 * records get written and with what extra fields (e.g. knownTransports).
 */
import { Agent, AgentConfig, AgentIdentity, PeerGraph, Parts, DataPart,
         RelayTransport } from '@canopy/core';
import {
  KeychainVault,
  MdnsTransport,
  BleTransport,
  AsyncStorageAdapter,
} from '@canopy/react-native';
import { registerRelaySkill }    from './relaySkill.js';
import { registerPeerListSkill } from './routing/setup.js';
import { messageStore }          from './store/messages.js';
import { requestPermissions }    from './permissions.js';

/**
 * Build and start the agent.  Call once at app startup.
 *
 * @param {object} opts
 * @param {string} [opts.relayUrl]  — ws:// URL of the local relay server.
 *   When provided the agent adds a RelayTransport so it can reach browser
 *   demo tabs (demo-dot.html etc.) that also connect to the same relay.
 *   Without this the phone only talks to other phones via mDNS / BLE.
 * @returns {Promise<import('@canopy/core').Agent>}
 */
export async function createAgent({ relayUrl } = {}) {
  // ── Permissions (must happen before any native transport is created) ────────
  const perms = await requestPermissions();

  // ── Identity (persisted in OS keychain across app restarts) ────────────────
  const vault = new KeychainVault({ service: 'mesh-demo' });

  let identity;
  try {
    identity = await AgentIdentity.restore(vault);
  } catch {
    // First run: generate a new keypair
    identity = await AgentIdentity.generate(vault);
  }

  // ── Transports (each wrapped individually so one failure doesn't kill startup)
  let mdns = null;
  // To disable mDNS for debugging: comment out this block and change
  //   const primary = mdns ?? relay  →  const primary = relay
  if (MdnsTransport.isAvailable()) {
    try {
      mdns = new MdnsTransport({
        identity,
        hostname: `dw-${identity.pubKey.slice(0, 8)}`,
      });
    } catch (e) {
      console.warn('MdnsTransport init failed:', e?.message);
    }
  }

  let ble = null;
  if (perms.ble) {
    try {
      ble = new BleTransport({ identity, advertise: true, scan: true });
    } catch (e) {
      console.warn('BleTransport init failed:', e?.message);
    }
  }

  // ── PeerGraph (persisted via AsyncStorage) ─────────────────────────────────
  const peers = new PeerGraph({
    storageBackend: new AsyncStorageAdapter({ prefix: 'mesh-demo:peers:' }),
  });

  // ── Config ─────────────────────────────────────────────────────────────────
  const config = new AgentConfig({
    overrides: {
      discovery: {
        discoverable:         true,
        // Accept hello from new peers (tier 0) so first contact works
        acceptHelloFromTier0: true,
      },
      policy: {
        // Opt-in: relay messages for tier-1+ trusted peers only.
        // 'never' is the SDK default; 'trusted' means the peer must have
        // completed a hello handshake with us (their pubKey is registered).
        allowRelayFor: 'trusted',
      },
    },
  });

  // ── Relay transport (also used as primary fallback if mDNS failed) ──────────
  let relay = null;
  if (relayUrl) {
    try {
      relay = new RelayTransport({ relayUrl, identity });
    } catch (e) {
      console.warn('RelayTransport init failed:', e?.message);
    }
  }

  // Primary transport: prefer mDNS → relay → give up
  const primary = mdns ?? relay;
  if (!primary) {
    throw new Error(
      'No transport could be initialised.\n' +
      `mDNS failed: ${!mdns}\n` +
      `Relay failed or no URL given: ${!relay}\n` +
      'Check permissions and relay URL.'
    );
  }

  // ── Agent ──────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity,
    transport: primary,
    peers,
    config,
    label: 'mesh-phone',
  });

  if (ble)                          agent.addTransport('ble',   ble);
  if (relay && primary !== relay)   agent.addTransport('relay', relay);

  // ── Inbound hello → PeerGraph ──────────────────────────────────────────────
  // When a remote peer initiates a hello, the Agent emits 'peer'.
  // We upsert it into the graph here (app decision — not automatic in the SDK).
  agent.on('peer', ({ address, pubKey, label, ack }) => {
    if (!pubKey) return;

    // Determine which transport delivered this hello based on the address format.
    // BLE peers use the BLE device MAC / pubKey; mDNS peers use the pubKey too,
    // but MdnsTransport's address is the agent pubKey in both cases.
    // We'll rely on the transport that received the envelope in a future version;
    // for now, record the address and let PeerGraph merge later discoveries.
    peers.upsert({
      type:          'native',
      pubKey,
      label:         label ?? null,
      reachable:     true,
      lastSeen:      Date.now(),
      discoveredVia: ack ? 'hello-ack' : 'hello-inbound',
      transports:    { default: { address, lastSeen: Date.now() } },
    }).catch(() => {});
  });

  // ── Skills ────────────────────────────────────────────────────────────────

  // Receive a text message from any peer and add it to the message store.
  agent.register('receive-message', async ({ parts, from }) => {
    const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    messageStore.add(from, { direction: 'in', text });
    return [DataPart({ ack: true })];
  }, { visibility: 'public', description: 'Receive a text message' });

  // Cooperative relay (opt-in, trust-gated — see policy.allowRelayFor in config)
  registerRelaySkill(agent);

  // Gossip: respond to peer-list requests from trusted peers
  registerPeerListSkill(agent);

  await agent.start();
  return agent;
}
