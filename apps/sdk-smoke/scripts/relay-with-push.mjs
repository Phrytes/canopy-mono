#!/usr/bin/env node
/**
 * relay-with-push — start a local relay configured for E2c push wake.
 *
 * Usage:
 *   node apps/sdk-smoke/scripts/relay-with-push.mjs [port]
 *
 * Wires:
 *   - `ExpoPushSender` with default fetch (calls https://exp.host/--/api/v2/push/send).
 *     Pass EXPO_ACCESS_TOKEN env var if your project requires enhanced security.
 *   - In-memory `PushTokenRegistry`.
 *   - Verbose logging on (so you see register-push-token + push-failed lines).
 *   - Tight throttle (5s) so deep verification doesn't sit around waiting.
 *
 * Pair with:
 *   node apps/sdk-smoke/scripts/trigger-s11.mjs <relayUrl> <phone-pubkey>
 * after the phone has pressed Run on S11.
 */
import {
  startRelay,
  ExpoPushSender,
  PushTokenRegistry,
  getLanIp,
} from '@canopy/relay';

const port = Number(process.argv[2]) || 8787;
const accessToken = process.env.EXPO_ACCESS_TOKEN || undefined;

const pushSender = new ExpoPushSender({ accessToken });
const registry   = new PushTokenRegistry();

const relay = await startRelay({
  port,
  log:               true,
  pushSender,
  pushTokenRegistry: registry,
  pushThrottleMs:    5_000,
});

const lan = getLanIp?.() ?? '127.0.0.1';
console.log('');
console.log(`relay-with-push: listening on ws://${lan}:${relay.port}`);
console.log('relay-with-push: ExpoPushSender wired (no access token; set EXPO_ACCESS_TOKEN if your project enforces it)');
console.log('');
console.log('relay-with-push: configure the phone with:');
console.log(`  RELAY_URL = 'ws://${lan}:${relay.port}'`);
console.log('  in apps/sdk-smoke/src/lib/config.js (then rebuild the app).');
console.log('');
console.log('relay-with-push: when the phone has pressed S11, trigger from another shell:');
console.log(`  node apps/sdk-smoke/scripts/trigger-s11.mjs ws://${lan}:${relay.port} <phone-pubkey>`);
console.log('');

// Periodically print the registry so we know push tokens are landing.
const interval = setInterval(() => {
  if (registry.size() > 0) {
    console.log(`relay-with-push: ${registry.size()} push token(s) registered`);
  }
}, 10_000);

process.on('SIGINT', async () => {
  clearInterval(interval);
  console.log('\nrelay-with-push: stopping…');
  await relay.stop();
  process.exit(0);
});
