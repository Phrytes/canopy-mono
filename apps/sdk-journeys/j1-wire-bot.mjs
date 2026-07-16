/**
 * J1 — wire bot: a minimally-connected external bot at the protocol level.
 *
 * The imagined developer: someone building a headless bot (a monitoring
 * probe, a bridge, a script) that must talk to an existing Onderling host
 * agent. They do not want the batteries-included facade — they want to see
 * the actual wire: an identity, a transport, peer registration, a message,
 * and a skill call with its task lifecycle.
 *
 * What it proves: the kernel package `@onderling/core` (plus a vault from
 * `@onderling/vault` to hold the key material) is sufficient to
 *   1. mint a sovereign agent identity,
 *   2. connect two independent agents over an in-process transport
 *      (`InternalBus` + `InternalTransport` — no network, no servers),
 *   3. exchange a plain message (the `message` protocol event), and
 *   4. call a skill and observe the task complete with a real result.
 *
 * Everything here runs offline in one Node process.
 */
import assert from 'node:assert/strict';
import {
  Agent,
  AgentIdentity,
  InternalBus,
  InternalTransport,
  Parts,
  callSkill,
  sendMessage,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

function step(n, text) { console.log(`  ${n}. ${text}`); }

console.log('J1 wire-bot — external bot talks to a host agent at the wire level');

// ── 1. Mint identities (bot + host), each in its own in-memory vault ───────
const botVault  = new VaultMemory();
const botId     = await AgentIdentity.generate(botVault);
const hostId    = await AgentIdentity.generate(new VaultMemory());
assert.ok(botId.pubKey && botId.pubKey.length > 0, 'bot identity has a public key');
assert.notEqual(botId.pubKey, hostId.pubKey, 'bot and host identities are distinct');
step(1, `generated two agent identities (bot ${botId.pubKey.slice(0, 8)}…, host ${hostId.pubKey.slice(0, 8)}…)`);

// ── 2. One shared in-process bus; one InternalTransport per agent ──────────
const bus  = new InternalBus();
const host = new Agent({
  identity:  hostId,
  transport: new InternalTransport(bus, hostId.pubKey, { identity: hostId }),
  label:     'host',
});
const bot = new Agent({
  identity:  botId,
  transport: new InternalTransport(bus, botId.pubKey, { identity: botId }),
  label:     'wire-bot',
});
step(2, 'built host + bot agents on a shared InternalBus (offline, in-process)');

// ── 3. Host exposes one skill; both agents start ────────────────────────────
host.register('greet', async ({ parts }) => {
  const args = Parts.data(parts) ?? {};
  return { greeting: `Hello, ${args.name ?? 'stranger'}!` };
}, { description: 'Greets the caller by name' });
await host.start();
await bot.start();
step(3, 'host registered the "greet" skill; both agents started');

// ── 4. Exchange public keys (peer registration → encrypted envelopes) ──────
bot.addPeer(host.address, host.pubKey);
host.addPeer(bot.address, bot.pubKey);
step(4, 'exchanged peer public keys (bot ↔ host)');

// ── 5. Exchange a plain protocol message ────────────────────────────────────
const received = new Promise((resolve) => host.once('message', resolve));
await sendMessage(bot, host.address, 'ping from the wire bot');
const msg = await received;
assert.equal(Parts.text(msg.parts), 'ping from the wire bot', 'host received the exact message text');
step(5, `host received the bot's message: "${Parts.text(msg.parts)}"`);

// ── 6. Call the host's skill through the task protocol ─────────────────────
const task   = callSkill(bot, host.address, 'greet', Parts.wrap({ name: 'Journey Bot' }));
const result = await task.done();
assert.equal(result.state, 'completed', `task completed (got "${result.state}")`);
const reply = Parts.data(result.parts);
assert.equal(reply.greeting, 'Hello, Journey Bot!', 'skill returned the computed greeting');
step(6, `skill call completed over the wire: ${JSON.stringify(reply)}`);

await bot.stop();
await host.stop();

console.log('✓ J1 wire-bot: PASS');
