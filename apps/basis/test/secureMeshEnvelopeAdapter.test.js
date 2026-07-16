/**
 * secureMeshEnvelopeAdapter — OBJ-2 keystone: notify-envelope over the real
 * secure-mesh wire. Wires two adapters together through a fake peer bus
 * (A.sendPeerMessage delivers to B.handleInbound) and asserts the
 * `{ publishEnvelope, subscribeEnvelopes }` contract + inbound routing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSecureMeshEnvelopeAdapter } from '../src/core/sync/secureMeshEnvelopeAdapter.js';

// A 2+-node bus: sendPeerMessage(to,msg) → the dest adapter's handleInbound(from,msg).
function makeBus() {
  const nodes = new Map();
  function connect(address) {
    const adapter = createSecureMeshEnvelopeAdapter({
      selfAddress:     address,
      sendPeerMessage: async (to, payload) => { nodes.get(to)?.handleInbound(address, payload); },
    });
    nodes.set(address, adapter);
    return adapter;
  }
  return { connect };
}

describe('createSecureMeshEnvelopeAdapter (OBJ-2 keystone)', () => {
  it('round-trips an envelope publisher → subscriber over the wire', async () => {
    const bus = makeBus();
    const A = bus.connect('A');
    const B = bus.connect('B');
    const got = [];
    B.subscribeEnvelopes((w) => got.push(w));

    await A.publishEnvelope({
      recipients: ['B'],
      kind:       'household',
      ref:        'pseudo-pod://A/household/items/1',
      payload:    { id: '1', text: 'Milk' },
      etag:       'e1',
      _v:         3,
    });

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      v: 1, kind: 'household', ref: 'pseudo-pod://A/household/items/1',
      payload: { id: '1', text: 'Milk' }, etag: 'e1', _v: 3,
      fromActor: 'A',                 // stamped by handleInbound (no explicit fromActor)
    });
    expect(typeof got[0].timestamp).toBe('string');
  });

  it('fans out to every recipient but never to self', async () => {
    const bus = makeBus();
    const A = bus.connect('A');
    const B = bus.connect('B');
    const C = bus.connect('C');
    const onA = []; const onB = []; const onC = [];
    A.subscribeEnvelopes((w) => onA.push(w));
    B.subscribeEnvelopes((w) => onB.push(w));
    C.subscribeEnvelopes((w) => onC.push(w));

    await A.publishEnvelope({ recipients: ['A', 'B', 'C'], kind: 'household', payload: { id: '9' } });

    expect(onB).toHaveLength(1);
    expect(onC).toHaveLength(1);
    expect(onA).toHaveLength(0);     // 'A' is self → filtered, no self-send
  });

  it('preserves an explicit fromActor (the original author, not the relaying peer)', async () => {
    const bus = makeBus();
    const A = bus.connect('A');
    const B = bus.connect('B');
    const got = [];
    B.subscribeEnvelopes((w) => got.push(w));
    await A.publishEnvelope({ recipients: ['B'], kind: 'household', fromActor: 'webid:author', payload: { id: '2' } });
    expect(got[0].fromActor).toBe('webid:author');
  });

  it('throws on a missing kind and no-ops on empty recipients', async () => {
    const spy = vi.fn();
    const x = createSecureMeshEnvelopeAdapter({ sendPeerMessage: spy });
    await expect(x.publishEnvelope({ recipients: ['B'] })).rejects.toThrow(/kind/);
    await x.publishEnvelope({ recipients: [], kind: 'household' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('handleInbound ignores non-envelope payloads (returns false → router falls through)', () => {
    const b = createSecureMeshEnvelopeAdapter({ sendPeerMessage: async () => {} });
    expect(b.handleInbound('A', { someDM: 'hi' })).toBe(false);
    expect(b.handleInbound('A', null)).toBe(false);
    expect(b.handleInbound('A', { __ntfyEnv: { /* no kind */ } })).toBe(false);
    expect(b.handleInbound('A', { __ntfyEnv: { kind: 'household' } })).toBe(true);
  });

  it('unsubscribe stops delivery', async () => {
    const bus = makeBus();
    const A = bus.connect('A');
    const B = bus.connect('B');
    const got = [];
    const off = B.subscribeEnvelopes((w) => got.push(w));
    off();
    await A.publishEnvelope({ recipients: ['B'], kind: 'household', payload: { id: '1' } });
    expect(got).toHaveLength(0);
  });

  it('requires sendPeerMessage', () => {
    expect(() => createSecureMeshEnvelopeAdapter({})).toThrow(/sendPeerMessage/);
  });
});
