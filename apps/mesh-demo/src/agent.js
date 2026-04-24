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
import {
  DataPart, TextPart, Parts,
  registerCapabilitiesSkill,
  registerTunnelReceiveSealed,
} from '@canopy/core';
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
    // Rendezvous is OFF on the phone for now.  react-native-webrtc
    // 124.0.7 still fails to register WebRTCModule under RN 0.76's
    // default bridgeless JS runtime (same "WebRTC native module not
    // found" / native SIGSEGV as 124.0.5 — PR #1731's TurboModule
    // fix covers RN 0.80+ but not 0.76's flavor of bridgeless).
    //
    // Re-enable when any of these unblock:
    //   • Upstream rn-webrtc publishes a release with RN 0.76-aware
    //     bridgeless support.
    //   • We adopt the GetStream fork that has the full bridgeless
    //     port upstream tried to cherry-pick from in #1731.
    //   • We pin a React Native / Expo config that keeps bridgeless
    //     off on 0.76 (requires MainApplication override).
    //
    // History + fallbacks documented in CODING-PLAN.md § DD4.
    rendezvous: false,
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
  // Tunnel (Group CC) — this phone can act as a bridge for other peers'
  // streaming / IR / cancel calls AND can be the target of sealed tunnels.
  agent.enableReachabilityOracle();
  registerCapabilitiesSkill(agent);
  agent.enableSealedForwardFor('mesh');
  agent.enableTunnelForward({ policy: 'authenticated' });
  registerTunnelReceiveSealed(agent);

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

  // A tiny streaming test skill for exercising Group CC tunnels from a
  // laptop browser tab (or another phone).  Yields `count` chunks, each
  // with the phrase + index.  Remove once streaming is wired into real UI.
  agent.register('stream-demo', async function* ({ parts }) {
    const d     = Parts.data(parts) ?? {};
    const text  = typeof d.text  === 'string' ? d.text  : 'hello from phone';
    const count = Number.isFinite(d.count)    ? d.count : 3;
    for (let i = 1; i <= count; i++) {
      yield [TextPart(`${text} [${i}/${count}]`)];
      // Small gap so the caller actually sees chunks arriving over time.
      await new Promise(r => setTimeout(r, 250));
    }
  }, { visibility: 'public', description: 'Stream a short demo message (CC test skill)' });

  return agent;
}
