/**
 * startRelay — integration tests.
 * See EXTRACTION-PLAN.md §7 Group S and CODING-PLAN.md Group S.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay } from '../src/server.js';

// ── Self-signed cert fixture, generated per test run so there is no ─────────
// ── on-disk state. Uses selfsigned library if present, otherwise skips TLS. ──

async function loadSelfsigned() {
  try {
    const mod = await import('selfsigned');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// ── Helper client ────────────────────────────────────────────────────────────

function openClient(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    ws.messages = [];
    ws.on('message', (raw) => {
      try { ws.messages.push(JSON.parse(raw)); } catch {}
    });
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for predicate (${timeoutMs}ms)`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

// ── Plain ws:// tests ────────────────────────────────────────────────────────

describe('startRelay — ws://', () => {
  let relay;

  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('listens and returns an ephemeral port', () => {
    expect(relay.port).toBeGreaterThan(0);
    expect(relay.tls).toBe(false);
  });

  it('replies to register with a `registered` ack', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: 'alice' });

    await waitFor(() => ws.messages.some(m => m.type === 'registered'));
    ws.close();
  });

  it('forwards a send from alice to bob', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    const bob   = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(alice, { type: 'register', address: 'alice' });
    send(bob,   { type: 'register', address: 'bob'   });
    await waitFor(() => alice.messages.some(m => m.type === 'registered')
                     && bob.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'send', to: 'bob', envelope: { _p: 'OW', payload: { hi: true } } });

    await waitFor(() => bob.messages.some(m => m.type === 'message'));
    const delivered = bob.messages.find(m => m.type === 'message');
    expect(delivered.envelope.payload).toEqual({ hi: true });

    alice.close(); bob.close();
  });

  it('buffers messages to an offline peer and drains on register', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: 'alice' });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // Send to bob while he's offline.
    send(alice, { type: 'send', to: 'bob', envelope: { _p: 'OW', payload: { n: 1 } } });
    send(alice, { type: 'send', to: 'bob', envelope: { _p: 'OW', payload: { n: 2 } } });
    // Small delay to let the relay buffer them.
    await new Promise(r => setTimeout(r, 30));

    // Bob comes online — should receive the two buffered messages.
    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: 'bob' });

    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 2,
    );
    const delivered = bob.messages.filter(m => m.type === 'message');
    expect(delivered.map(m => m.envelope.payload.n)).toEqual([1, 2]);

    alice.close(); bob.close();
  });

  it('broadcasts peer-list on connect and disconnect', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: 'alice' });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: 'bob' });

    // Alice should receive a peer-list broadcast that includes bob.
    await waitFor(() => alice.messages.some(
      m => m.type === 'peer-list' && m.peers?.includes('bob'),
    ));

    bob.close();

    await waitFor(() => {
      const peerLists = alice.messages.filter(m => m.type === 'peer-list');
      const last     = peerLists[peerLists.length - 1];
      return last && !last.peers?.includes('bob');
    });

    alice.close();
  });

  it('responds to a peer-list request with the current client list', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: 'alice' });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'peer-list' });
    await waitFor(() => alice.messages.some(
      m => m.type === 'peer-list' && m.peers?.includes('alice'),
    ));

    alice.close();
  });

  it('rejects register without an address', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register' });

    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    const err = ws.messages.find(m => m.type === 'error');
    expect(err.message).toMatch(/missing address/i);
    ws.close();
  });
});

// ── TLS config validation ───────────────────────────────────────────────────

describe('startRelay — config', () => {
  it('throws when only one of tlsCert / tlsKey is provided', async () => {
    await expect(startRelay({ port: 0, tlsCert: 'cert' })).rejects.toThrow(/both/);
    await expect(startRelay({ port: 0, tlsKey:  'key'  })).rejects.toThrow(/both/);
  });
});

// ── wss:// tests (skipped if `selfsigned` is not installed) ──────────────────

describe('startRelay — wss://', async () => {
  const selfsigned = await loadSelfsigned();
  const testFn = selfsigned ? it : it.skip;

  let relay;
  let cert, key;

  if (selfsigned) {
    // selfsigned v5+ returns a Promise (uses WebCrypto under the hood).
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'localhost' }],
      { days: 1, keySize: 2048 },
    );
    cert = pems.cert;
    key  = pems.private;
  }

  beforeEach(async () => {
    if (!selfsigned) return;
    relay = await startRelay({ port: 0, tlsCert: cert, tlsKey: key });
  });

  afterEach(async () => {
    if (relay) await relay.stop();
  });

  testFn('accepts wss:// connections and round-trips a message', async () => {
    // Self-signed cert → skip hostname/CA checks in the test client.
    const wsOpts = { rejectUnauthorized: false };

    const alice = await openClient(`wss://localhost:${relay.port}`, wsOpts);
    const bob   = await openClient(`wss://localhost:${relay.port}`, wsOpts);
    send(alice, { type: 'register', address: 'alice' });
    send(bob,   { type: 'register', address: 'bob'   });
    await waitFor(() => alice.messages.some(m => m.type === 'registered')
                     && bob.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'send', to: 'bob', envelope: { _p: 'OW', payload: { secure: true } } });
    await waitFor(() => bob.messages.some(m => m.type === 'message'));
    expect(bob.messages.find(m => m.type === 'message').envelope.payload).toEqual({ secure: true });

    alice.close(); bob.close();
  });
});
