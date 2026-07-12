#!/usr/bin/env node
/**
 * Live relay smoke test — one command to check a DEPLOYED relay end-to-end.
 *
 *   node deploy/smoke/smoke.mjs wss://your-relay.example        # or set RELAY_URL
 *
 * Validates the deployment over the relay's documented wire protocol
 * (register / send / message — see packages/relay/src/server.js):
 *   1. reachability        — wss:// TLS + WebSocket upgrade + register ack
 *   2. two-party delivery  — A↔B both directions
 *   3. offline hold        — messages to an offline peer are held + flushed on reconnect
 *   4. multi-party fan-out  — a small circle, one member offline, no loss / no cross-talk
 *
 * Portable on purpose: the only dependency is `ws` (in this monorepo it resolves
 * from the root; standalone, `npm i ws`). This checks the DEPLOYMENT — the full
 * Agent / envelope-security / sealed-inbox integration lives in the workspace
 * test suites (packages/**, apps/companion-node, j-offline).
 *
 * Exit code 0 = all passed, 1 = a check failed, 2 = usage error.
 */
import { randomBytes } from 'node:crypto';

const URL = process.argv[2] || process.env.RELAY_URL;
if (!URL) {
  console.error('usage: node deploy/smoke/smoke.mjs <wss://relay-url>   (or set RELAY_URL)');
  process.exit(2);
}

const WebSocket = (await import('ws')).default;
const wait  = (ms) => new Promise(r => setTimeout(r, ms));
const addr  = (name) => `smoke-${name}-${randomBytes(6).toString('hex')}`;
const text  = (t) => ({ parts: [{ type: 'TextPart', text: t }], _p: 'OW' });
const readText = (env) => env?.parts?.[0]?.text;

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ ok: !!cond });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`);
};

/** Minimal relay wire-protocol client: register by address, send/receive envelopes. */
class RelayClient {
  constructor(url, address) { this.url = url; this.address = address; this.inbox = []; this._ws = null; }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this._ws = ws;
      const timer = setTimeout(() => reject(new Error(`register timeout (${this.address})`)), 10_000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'register', address: this.address })));
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'registered') { clearTimeout(timer); resolve(); return; }
        if (msg.type === 'message' && msg.envelope) this.inbox.push(readText(msg.envelope));
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  send(to, t) { this._ws.send(JSON.stringify({ type: 'send', to, envelope: text(t) })); }
  close() {
    return new Promise(res => {
      const ws = this._ws;
      if (!ws || ws.readyState === 3 /* CLOSED */) return res();
      ws.once('close', res);
      setTimeout(res, 2_000);   // never hang the runner on a stuck/errored socket
      try { ws.close(); } catch { res(); }
    });
  }
  async reconnect() { await this.connect(); }   // same address → relay flushes its held queue
}

console.log(`\n=== Relay smoke test → ${URL} ===\n`);

// ── 1. Reachability ─────────────────────────────────────────────────────────
const ann = new RelayClient(URL, addr('ann'));
const bob = new RelayClient(URL, addr('bob'));
let reachable = false;
try { await ann.connect(); await bob.connect(); reachable = true; }
catch (e) { check('reachable: wss:// upgrade + register', false, e.message); }
if (reachable) check('reachable: wss:// upgrade + register ack', true);

if (reachable) {
  // ── 2. Two-party, both directions ─────────────────────────────────────────
  ann.send(bob.address, 'ping A→B');
  bob.send(ann.address, 'pong B→A');
  await wait(800);
  check('two-party A→B delivered', bob.inbox.includes('ping A→B'), `bob=${JSON.stringify(bob.inbox)}`);
  check('two-party B→A delivered', ann.inbox.includes('pong B→A'), `ann=${JSON.stringify(ann.inbox)}`);

  // ── 3. Offline hold + flush on reconnect ───────────────────────────────────
  await bob.close();
  await wait(500);
  const held = ['held-1', 'held-2', 'held-3'];
  for (const m of held) { ann.send(bob.address, m); await wait(120); }
  await wait(500);
  const nothingWhileOffline = held.every(m => !bob.inbox.includes(m));
  check('nothing delivered while offline', nothingWhileOffline);
  await bob.reconnect();
  await wait(1500);
  const gotAll = held.every(m => bob.inbox.includes(m));
  const order  = bob.inbox.filter(m => held.includes(m));
  check('offline messages flushed on reconnect (order preserved)',
    gotAll && JSON.stringify(order) === JSON.stringify(held), `got=${JSON.stringify(order)}`);

  // ── 4. Multi-party fan-out with an offline member ─────────────────────────
  const carol = new RelayClient(URL, addr('carol'));
  const dave  = new RelayClient(URL, addr('dave'));
  await carol.connect(); await dave.connect();
  const circle = [ann, bob, carol, dave];
  const bcast  = (from, t) => { for (const m of circle) if (m !== from) from.send(m.address, t); };

  await dave.close(); await wait(500);
  const b1 = 'circle: koffie zaterdag';
  bcast(ann, b1); await wait(800);
  check('broadcast reaches online members (Bob+Carol)',
    bob.inbox.includes(b1) && carol.inbox.includes(b1) && !dave.inbox.includes(b1));
  await dave.reconnect(); await wait(1500);
  check('offline member (Dave) gets the broadcast on reconnect', dave.inbox.includes(b1));
  check('no self-delivery (Ann never receives her own broadcast)', !ann.inbox.includes(b1));

  for (const c of [carol, dave]) await c.close();
}
for (const c of [ann, bob]) await c.close().catch(() => {});

const passed = results.filter(r => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
