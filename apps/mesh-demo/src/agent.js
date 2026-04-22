/**
 * createAgent — mesh-chat agent factory.
 *
 * Everything "infrastructure" (transports, routing, BLE write queue,
 * OfflineTransport fallback, hello auto-upgrade of stale indirect records,
 * …) lives in `@canopy/react-native`'s `createMeshAgent`.  This file
 * only adds what is genuinely app-specific:
 *   • the `receive-message` skill, which pipes chat text into the store
 *   • the three opt-in SDK hooks this app wants enabled
 *
 * See EXTRACTION-PLAN.md §7 Group U for the full rewrite rationale.
 */
import { DataPart, Parts, registerCapabilitiesSkill } from '@canopy/core';
import {
  createMeshAgent,
  KeychainVault,
}                                  from '@canopy/react-native';
import { messageStore }            from './store/messages.js';

export async function createAgent({ relayUrl } = {}) {
  const agent = await createMeshAgent({
    label:    'mesh-phone',
    relayUrl,
    vault:    new KeychainVault({ service: 'mesh-demo' }),
    peerGraphPrefix: 'mesh-demo:peers:',
  });

  // Opt-in SDK behaviour: gossip, hop routing via relay-forward, and
  // auto-hello on discovery.  See CODING-PLAN.md Groups N/R.
  agent.enableRelayForward({ policy: 'authenticated' });
  agent.enableAutoHello({ pullPeers: true });
  agent.startDiscovery({ gossipIntervalMs: 15_000 });

  // Oracle (Group T) — on-the-fly bridge selection when routing hop messages.
  // Capabilities skill (Group AA3) — peers can poll our current feature flags.
  // Sealed-forward (Group BB) — messages in the "mesh" group travel blind
  // through any relay bridge, so the bridge cannot read the payload.
  agent.enableReachabilityOracle();
  registerCapabilitiesSkill(agent);
  agent.enableSealedForwardFor('mesh');

  // ── App-specific skills ────────────────────────────────────────────────────
  // receive-message pipes a text part into the message store, attributed
  // to the *original* caller (originFrom) when the message travelled
  // through a relay-forward hop.  originVerified is true when the message
  // carried a valid Ed25519 signature from the originator (Group Z), which
  // is the only way to trust originFrom across an untrusted bridge.
  agent.register('receive-message', async ({ parts, originFrom, from, originVerified }) => {
    const text   = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    const sender = originFrom ?? from;
    messageStore.add(sender, {
      direction:      'in',
      text,
      originVerified: !!originVerified,
      relayedBy:      originFrom && originFrom !== from ? from : null,
    });
    return [DataPart({ ack: true })];
  }, { visibility: 'public', description: 'Receive a text message' });

  return agent;
}
