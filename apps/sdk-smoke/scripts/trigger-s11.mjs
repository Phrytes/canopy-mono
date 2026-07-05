#!/usr/bin/env node
/**
 * trigger-s11 — laptop-side trigger for the S11 push-wake scenario.
 *
 * Connects to the relay as an ephemeral peer and `agent.invoke()`s the
 * `s11-wake` skill on the phone.  When the phone is offline (backgrounded),
 * the relay queues the envelope and fires a push wake; the phone wakes,
 * reconnects, drains the envelope, and `s11-wake` runs.
 *
 * Usage:
 *   node apps/sdk-smoke/scripts/trigger-s11.mjs <relayUrl> <phone-pubkey>
 *
 * Example:
 *   node apps/sdk-smoke/scripts/trigger-s11.mjs ws://192.168.1.10:8787 \
 *     A1B2C3D4...
 *
 * The phone-pubkey is what S11 logs in the harness ("agent.address").
 *
 * Tips:
 *   - Press Run on S11 BEFORE running this trigger.  S11 must be in its
 *     60s waiting window.
 *   - Background the app on the phone before running this so you exercise
 *     the actual push-wake path (not the connected fast-path).
 */
import { Agent, AgentIdentity, RelayTransport } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

const [, , relayUrl, phonePubKey] = process.argv;

if (!relayUrl || !phonePubKey) {
  console.error('Usage: node trigger-s11.js <relayUrl> <phone-pubkey>');
  process.exit(2);
}

console.log(`trigger-s11: relay = ${relayUrl}`);
console.log(`trigger-s11: phone = ${phonePubKey.slice(0, 24)}…`);

const id    = await AgentIdentity.generate(new VaultMemory());
const agent = new Agent({
  identity:  id,
  transport: new RelayTransport({ relayUrl, identity: id }),
  label:     'trigger-s11',
});

// Tell the agent who the peer is.  In relay-only mode, address === pubKey.
agent.addPeer(phonePubKey, phonePubKey);

await agent.start();
console.log(`trigger-s11: ✓ connected as ${id.pubKey.slice(0, 24)}…`);
console.log('trigger-s11: invoking s11-wake on the phone (60s timeout)…');

const start = Date.now();
try {
  const result = await agent.invoke(phonePubKey, 's11-wake', [], { timeoutMs: 60_000 });
  const elapsed = Date.now() - start;
  console.log(`trigger-s11: ✓ s11-wake completed in ${elapsed}ms`);
  console.log('trigger-s11: result parts:', result);
} catch (err) {
  const elapsed = Date.now() - start;
  console.error(`trigger-s11: ✗ FAIL after ${elapsed}ms: ${err?.message ?? err}`);
  process.exit(1);
} finally {
  await agent.stop?.();
  process.exit(0);
}
