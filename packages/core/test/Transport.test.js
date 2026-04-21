import { describe, it, expect, vi } from 'vitest';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { P } from '../src/Envelope.js';

function makePair() {
  const bus = new InternalBus();
  const a   = new InternalTransport(bus, 'alice');
  const b   = new InternalTransport(bus, 'bob');
  return { bus, a, b };
}

describe('InternalTransport connect / disconnect', () => {
  it('emits connect on connect()', async () => {
    const { a } = makePair();
    const handler = vi.fn();
    a.on('connect', handler);
    await a.connect();
    expect(handler).toHaveBeenCalledWith({ address: 'alice' });
  });

  it('emits disconnect on disconnect()', async () => {
    const { a } = makePair();
    await a.connect();
    const handler = vi.fn();
    a.on('disconnect', handler);
    await a.disconnect();
    expect(handler).toHaveBeenCalled();
  });

  it('stops receiving after disconnect', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();
    await b.disconnect();

    const received = [];
    b.on('envelope', e => received.push(e));

    await a.sendOneWay('bob', { msg: 'after disconnect' });
    await Promise.resolve();  // drain microtasks
    expect(received).toHaveLength(0);
  });
});

describe('sendOneWay (OW)', () => {
  it('delivers envelope to recipient', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();

    const received = [];
    b.on('envelope', e => received.push(e));

    await a.sendOneWay('bob', { msg: 'hello' });
    await Promise.resolve();
    expect(received).toHaveLength(1);
    expect(received[0]._p).toBe(P.OW);
    expect(received[0].payload).toEqual({ msg: 'hello' });
    expect(received[0]._from).toBe('alice');
    expect(received[0]._to).toBe('bob');
  });
});

describe('sendAck (AS)', () => {
  it('delivers AS and resolves with AK envelope', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();

    const received = [];
    b.on('envelope', e => received.push(e));

    const ack = await a.sendAck('bob', { msg: 'confirm me' });
    expect(ack._p).toBe(P.AK);
    expect(received).toHaveLength(1);
    expect(received[0]._p).toBe(P.AS);
  });

  it('times out if no AK arrives', async () => {
    const { a } = makePair();
    await a.connect();
    // No bob connected — no AK will be sent.
    await expect(a.sendAck('bob', {}, 50)).rejects.toThrow(/Timeout/);
  });
});

describe('request / respond (RQ/RS)', () => {
  it('resolves with RS envelope', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();

    b.on('envelope', async (env) => {
      if (env._p === P.RQ) {
        await b.respond(env._from, env._id, { result: 'pong' });
      }
    });

    const rs = await a.request('bob', { action: 'ping' });
    expect(rs._p).toBe(P.RS);
    expect(rs.payload).toEqual({ result: 'pong' });
  });

  it('times out if no RS arrives', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();
    // Bob receives but never responds.
    await expect(a.request('bob', {}, 50)).rejects.toThrow(/Timeout/);
  });
});

describe('setReceiveHandler', () => {
  it('calls receive handler instead of emitting envelope event', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();

    const events    = [];
    const handled   = [];
    b.on('envelope', e => events.push(e));
    b.setReceiveHandler(e => handled.push(e));

    await a.sendOneWay('bob', { x: 1 });
    await Promise.resolve();

    expect(events).toHaveLength(0);
    expect(handled).toHaveLength(1);
  });
});

describe('auto-ACK for AS envelopes', () => {
  it('auto-sends AK without the application doing anything', async () => {
    const { a, b } = makePair();
    await a.connect();
    await b.connect();

    // b has no handler — transport auto-ACKs anyway.
    const ack = await a.sendAck('bob', { x: 1 });
    expect(ack._p).toBe(P.AK);
  });
});
