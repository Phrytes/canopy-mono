/**
 * J-SECURITY BREACH SUITE — flood / storage abuse against the relay.
 * PLAN-real-usage-and-deployment.md §7 ("flood/storage abuse").
 *
 * Threat: a peer floods the relay with messages / connections to exhaust
 * memory or starve other users.
 *
 * DEFENDED (green):
 *   • The offline queue is BOUNDED. A peer spamming an offline target is
 *     capped per-(addr,topic) bucket (queueCap, FIFO eviction) AND per-address
 *     (queueCapTotal, default 4×) — no unbounded memory growth. Asserted via
 *     many-distinct-topic flooding hitting the global ceiling.
 *   • When the relay runs in GROUP mode (`acceptedGroups` + quotas), a member
 *     is rate-limited: over `maxConnections` → OVER_QUOTA_CONNECTIONS;
 *     over `msgsPerDay` → OVER_QUOTA_MSGS_PER_DAY.
 *
 * GAP (documented, see SECURITY-FINDINGS): in OPEN mode (the default — no
 * `acceptedGroups`), there is NO per-connection / per-message rate limit. A
 * peer can open unlimited connections and flood a LIVE (online) peer with
 * unlimited messages — the queue caps only bound buffering to OFFLINE peers.
 * The probe below documents the open-mode gap explicitly (it asserts the
 * absence of a limit, which is the finding, and is labelled as such).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay } from '../../src/server.js';
import { AgentIdentity, GroupManager } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (raw) => { try { ws.messages.push(JSON.parse(raw)); } catch {} });
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));
async function waitFor(pred, timeoutMs = 1_500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}
const publishFrame = (to, topic, n) => ({ type: 'send', to, topic, envelope: { _p: 'OW', _topic: topic, payload: { n } } });

let relay;
afterEach(async () => { await relay?.stop(); relay = null; });

describe('§7.10 — bounded offline queue (memory-exhaustion defense)', () => {
  it('DEFENDED: per-address global ceiling (queueCapTotal) caps a many-topic flood', async () => {
    // queueCap=2 → queueCapTotal = 2*4 = 8. Flood 30 distinct topics at an
    // offline peer; total buffered must not exceed the global ceiling.
    relay = await startRelay({ port: 0, queueCap: 2 });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(attacker, { type: 'register', address: 'attacker' });
    await waitFor(() => attacker.messages.some(m => m.type === 'registered'));

    // victim is OFFLINE — everything buffers.
    for (let t = 0; t < 30; t++) send(attacker, publishFrame('victim', `topic-${t}`, t));
    await new Promise(r => setTimeout(r, 50));

    const victim = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(victim, { type: 'register', address: 'victim' });
    await new Promise(r => setTimeout(r, 100));

    const delivered = victim.messages.filter(m => m.type === 'message').length;
    // The bound is queueCapTotal (8) — NOT the 30 sent. Proves buffering is capped.
    expect(delivered).toBeLessThanOrEqual(8);
    attacker.close(); victim.close();
  });
});

describe('§7.10 — group-mode rate limiting (opt-in defense)', () => {
  it('DEFENDED: over maxConnections fires OVER_QUOTA_CONNECTIONS (real group proofs)', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const gm    = new GroupManager({ identity: admin, vault: new VaultMemory() });
    const m1 = await AgentIdentity.generate(new VaultMemory());
    const m2 = await AgentIdentity.generate(new VaultMemory());
    const m3 = await AgentIdentity.generate(new VaultMemory());
    const p1 = await gm.issueProof(m1.pubKey, 'block');
    const p2 = await gm.issueProof(m2.pubKey, 'block');
    const p3 = await gm.issueProof(m3.pubKey, 'block');

    relay = await startRelay({
      port: 0,
      acceptedGroups: [{ groupId: 'block', adminPubKey: admin.pubKey, quotas: { maxConnections: 2 } }],
    });

    const ws1 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws1, { type: 'register', address: m1.pubKey, groupProof: p1 });
    await waitFor(() => ws1.messages.some(m => m.type === 'registered'));
    const ws2 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws2, { type: 'register', address: m2.pubKey, groupProof: p2 });
    await waitFor(() => ws2.messages.some(m => m.type === 'registered'));

    // The 3rd connection for the same group exceeds the cap → rejected.
    const ws3 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws3, { type: 'register', address: m3.pubKey, groupProof: p3 });
    await waitFor(() => ws3.messages.some(m => m.type === 'error'));
    expect(ws3.messages.find(m => m.type === 'error').message).toBe('OVER_QUOTA_CONNECTIONS');

    try { ws1.close(); ws2.close(); ws3.close(); } catch {}
  });
});

describe('§7.10 — GAP: open-mode relay has NO message rate limit (documented)', () => {
  it('a single peer can flood a LIVE peer with unlimited messages in open mode (no throttle)', async () => {
    // DEFAULT open mode: no acceptedGroups → no per-message quota.
    relay = await startRelay({ port: 0 });
    const attacker = await openClient(`ws://127.0.0.1:${relay.port}`);
    const victim   = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(attacker, { type: 'register', address: 'attacker' });
    send(victim,   { type: 'register', address: 'victim' });
    await waitFor(() => attacker.messages.some(m => m.type === 'registered')
                     && victim.messages.some(m => m.type === 'registered'));

    // Blast 200 live messages. If a rate limit existed, some would be
    // rejected (an 'error' frame back to the attacker). None are.
    const BLAST = 200;
    for (let n = 0; n < BLAST; n++) send(attacker, { type: 'send', to: 'victim', envelope: { _p: 'OW', payload: { n } } });
    await waitFor(() => victim.messages.filter(m => m.type === 'message').length >= BLAST, 3_000);

    const delivered = victim.messages.filter(m => m.type === 'message').length;
    const throttleErrors = attacker.messages.filter(m => m.type === 'error');
    // THE FINDING: every message got through and the attacker was never
    // throttled. This documents the open-mode flood gap (not a defense).
    expect(delivered).toBe(BLAST);
    expect(throttleErrors).toHaveLength(0);
    attacker.close(); victim.close();
  });
});
