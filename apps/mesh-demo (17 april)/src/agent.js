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
import { Agent, AgentConfig, AgentIdentity, PeerGraph } from '@onderling/core';
import {
  KeychainVault,
  MdnsTransport,
  BleTransport,
  AsyncStorageAdapter,
} from '@onderling/react-native';

/**
 * Build and start the agent.  Call once at app startup.
 *
 * @returns {Promise<import('@onderling/core').Agent>}
 */
export async function createAgent() {
  // ── Identity (persisted in OS keychain across app restarts) ────────────────
  const vault = new KeychainVault({ service: 'mesh-demo' });

  let identity;
  try {
    identity = await AgentIdentity.restore(vault);
  } catch {
    // First run: generate a new keypair
    identity = await AgentIdentity.generate(vault);
  }

  // ── Transports ─────────────────────────────────────────────────────────────
  const mdns = new MdnsTransport({
    identity,
    // Use the first 8 chars of the pubKey as the mDNS hostname so it's
    // stable across restarts but doesn't expose the full key in mDNS records.
    hostname: `dw-${identity.pubKey.slice(0, 8)}`,
  });

  const ble = new BleTransport({
    identity,
    advertise: true,
    scan: true,
  });

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

  // ── Agent ──────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity,
    transport: mdns,   // mDNS is the primary transport
    peers,
    config,
    label: 'mesh-phone',
  });

  // BLE is the secondary transport (added after construction)
  agent.addTransport('ble', ble);

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

  await agent.start();
  return agent;
}
