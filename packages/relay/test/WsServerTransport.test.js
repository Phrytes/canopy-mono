/**
 * WsServerTransport tests — in-process WebSocket clients (no real network I/O
 * beyond loopback) exercise the relay routing and offline-queue logic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { WsServerTransport } from '../src/WsServerTransport.js';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTransport(opts = {}) {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const transport = new WsServerTransport({ port: 0, address: id.pubKey, ...opts });
  await transport.start();
  return { transport, address: id.pubKey };
}

/**
 * Open a WebSocket, register as `address`.
 * Returns { ws, next } where next() pops the oldest buffered JSON message,
 * waiting up to `timeout` ms if none is queued yet.
 *
 * All messages are captured into a buffer the moment they arrive, so
 * callers never miss messages that land before they call next().
 */
function openClient(port, address) {
  return new Promise((resolve, reject) => {
    const ws     = new WebSocket(`ws://localhost:${port}`);
    const buffer = [];
    const pending = [];

    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (pending.length) {
        const { resolve: res, timer } = pending.shift();
        clearTimeout(timer);
        res(msg);
      } else {
        buffer.push(msg);
      }
    });

    ws.once('error', reject);
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'register', address }));
    });

    // Drain 'registered' from the buffer and then hand off the client.
    const waitRegistered = setInterval(() => {
      const idx = buffer.findIndex(m => m.type === 'registered');
      if (idx !== -1) {
        buffer.splice(idx, 1);
        clearInterval(waitRegistered);
        resolve({
          ws,
          next(timeout = 2000) {
            if (buffer.length) return Promise.resolve(buffer.shift());
            return new Promise((res, rej) => {
              const timer = setTimeout(
                () => { pending.splice(pending.findIndex(p => p.resolve === res), 1); rej(new Error('Timeout')); },
                timeout,
              );
              pending.push({ resolve: res, timer });
            });
          },
        });
      }
    }, 10);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WsServerTransport', () => {
  let relay;

  beforeEach(async () => {
    relay = await makeTransport();
  });

  afterEach(async () => {
    await relay.transport.stop();
  });

  it('starts and exposes a bound port', () => {
    expect(relay.transport.port).toBeTypeOf('number');
    expect(relay.transport.port).toBeGreaterThan(0);
  });

  it('accepts client connections and confirms registration', async () => {
    const { ws } = await openClient(relay.transport.port, 'client-1');
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('getConnectedPeers lists registered clients', async () => {
    const { ws } = await openClient(relay.transport.port, 'peer-a');
    expect(relay.transport.getConnectedPeers()).toContain('peer-a');
    ws.close();
  });

  it('removes peer from connected list on disconnect', async () => {
    const { ws } = await openClient(relay.transport.port, 'peer-b');
    await new Promise(resolve => {
      relay.transport.once('peer-disconnected', resolve);
      ws.close();
    });
    expect(relay.transport.getConnectedPeers()).not.toContain('peer-b');
  });

  it('forwards envelope from sender to recipient', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const { ws: wsSender } = await openClient(relay.transport.port, 'sender');
    const { next }         = await openClient(relay.transport.port, id.pubKey);

    const envelope = { _v: 1, _p: 'OW', _id: 'e1', _from: 'sender',
                       _to: id.pubKey, _ts: Date.now(), _sig: null, payload: 'hello' };
    wsSender.send(JSON.stringify({ type: 'send', to: id.pubKey, envelope }));

    const msg = await next();
    expect(msg.type).toBe('message');
    expect(msg.envelope._id).toBe('e1');
    expect(msg.envelope.payload).toBe('hello');

    wsSender.close();
  });

  it('delivers message to relay itself via _put → _receive', async () => {
    const received = [];
    relay.transport.setReceiveHandler(env => received.push(env));

    const envelope = { _v: 1, _p: 'OW', _id: 'self-1', _from: 'x',
                       _to: relay.address, _ts: Date.now(), _sig: null, payload: 'ping' };
    await relay.transport._put(relay.address, envelope);

    expect(received).toHaveLength(1);
    expect(received[0]._id).toBe('self-1');
  });

  it('queues envelope for offline peer and delivers on reconnect', async () => {
    const offlineAddr = 'offline-peer';
    const envelope = { _v: 1, _p: 'OW', _id: 'q1', _from: 'x',
                       _to: offlineAddr, _ts: Date.now(), _sig: null, payload: 'queued' };

    // Send while peer is offline.
    const { ws: wsSender } = await openClient(relay.transport.port, 'sender-q');
    wsSender.send(JSON.stringify({ type: 'send', to: offlineAddr, envelope }));
    await new Promise(r => setTimeout(r, 50));

    // Connect offline peer — queued message should be delivered.
    const { next } = await openClient(relay.transport.port, offlineAddr);
    const msg = await next(1000);

    expect(msg.type).toBe('message');
    expect(msg.envelope._id).toBe('q1');

    wsSender.close();
  });

  it('does not deliver expired queued messages', async () => {
    await relay.transport.stop();
    relay = await makeTransport({ offlineQueueTtl: 1 });

    const envelope = { _v: 1, _p: 'OW', _id: 'exp1', _from: 'x',
                       _to: 'late-peer', _ts: Date.now(), _sig: null, payload: 'expired' };

    const { ws: wsSender } = await openClient(relay.transport.port, 'sender-exp');
    wsSender.send(JSON.stringify({ type: 'send', to: 'late-peer', envelope }));
    await new Promise(r => setTimeout(r, 50));

    const { next } = await openClient(relay.transport.port, 'late-peer');
    await expect(next(200)).rejects.toThrow('Timeout');

    wsSender.close();
  });

  it('emits peer-connected when client registers', async () => {
    const addr = await new Promise(resolve => {
      relay.transport.once('peer-connected', resolve);
      openClient(relay.transport.port, 'new-peer').catch(() => {});
    });
    expect(addr).toBe('new-peer');
  });
});
