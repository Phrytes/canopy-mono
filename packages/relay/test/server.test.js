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

// ── Multi-recipient (E2b) ────────────────────────────────────────────────────

describe('startRelay — multi-recipient (E2b)', () => {
  let relay;

  beforeEach(async () => {
    relay = await startRelay({
      port: 0,
      // Tight poll interval keeps tests snappy.
      multiRecipientQueueOpts: { pollIntervalMs: 5, defaultTimeoutMs: 1_000 },
    });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('fans out a multi-request to B+C and returns aggregated responses to A', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    const b = await openClient(`ws://127.0.0.1:${relay.port}`);
    const c = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(a, { type: 'register', address: 'alice' });
    send(b, { type: 'register', address: 'bob'   });
    send(c, { type: 'register', address: 'carol' });
    await waitFor(() =>
      a.messages.some(m => m.type === 'registered') &&
      b.messages.some(m => m.type === 'registered') &&
      c.messages.some(m => m.type === 'registered'),
    );

    // A fires the multi-request.
    send(a, {
      type:    'multi-request',
      targets: ['bob', 'carol'],
      payload: { task: 'ping' },
      timeoutMs: 1_000,
    });

    // B and C each receive a multi-deliver; they reply.
    await waitFor(() => b.messages.some(m => m.type === 'multi-deliver'));
    await waitFor(() => c.messages.some(m => m.type === 'multi-deliver'));

    const bDeliver = b.messages.find(m => m.type === 'multi-deliver');
    const cDeliver = c.messages.find(m => m.type === 'multi-deliver');
    expect(bDeliver.from).toBe('alice');
    expect(bDeliver.id).toBe(cDeliver.id);
    expect(bDeliver.payload).toEqual({ task: 'ping' });

    send(b, { type: 'multi-response-from-target', id: bDeliver.id, response: { from: 'bob' } });
    send(c, { type: 'multi-response-from-target', id: cDeliver.id, response: { from: 'carol' } });

    await waitFor(() => a.messages.some(m => m.type === 'multi-response'));
    const reply = a.messages.find(m => m.type === 'multi-response');
    expect(reply.id).toBe(bDeliver.id);
    expect(reply.partial).toBe(false);
    expect(reply.responses).toHaveLength(2);
    const fromKeys = reply.responses.map(r => r.fromPubKey).sort();
    expect(fromKeys).toEqual(['bob', 'carol']);

    a.close(); b.close(); c.close();
  });

  it('returns a partial multi-response when a target does not reply before deadline', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    const b = await openClient(`ws://127.0.0.1:${relay.port}`);
    const c = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(a, { type: 'register', address: 'alice' });
    send(b, { type: 'register', address: 'bob'   });
    send(c, { type: 'register', address: 'carol' });
    await waitFor(() =>
      a.messages.some(m => m.type === 'registered') &&
      b.messages.some(m => m.type === 'registered') &&
      c.messages.some(m => m.type === 'registered'),
    );

    send(a, {
      type:    'multi-request',
      targets: ['bob', 'carol'],
      payload: { task: 'ping' },
      timeoutMs: 80,
    });

    await waitFor(() => b.messages.some(m => m.type === 'multi-deliver'));
    const bDeliver = b.messages.find(m => m.type === 'multi-deliver');
    // Only bob replies; carol stays silent.
    send(b, { type: 'multi-response-from-target', id: bDeliver.id, response: { from: 'bob' } });

    await waitFor(() => a.messages.some(m => m.type === 'multi-response'), 2_000);
    const reply = a.messages.find(m => m.type === 'multi-response');
    expect(reply.partial).toBe(true);
    expect(reply.responses).toHaveLength(1);
    expect(reply.responses[0].fromPubKey).toBe('bob');

    a.close(); b.close(); c.close();
  });

  it('rejects multi-request with non-array targets', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(a, { type: 'register', address: 'alice' });
    await waitFor(() => a.messages.some(m => m.type === 'registered'));

    send(a, { type: 'multi-request', targets: 'nope', payload: {} });
    await waitFor(() => a.messages.some(m => m.type === 'error' && /targets/i.test(m.message)));
    a.close();
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
