/**
 * NknTransport — @onderling/logger coverage + PII-safety (logging, TRANSPORT path).
 *
 * Drives connect / send / send-failure / disconnect against an injected fake nkn lib and asserts:
 *   1. transport.connect / transport.send / transport.send.fail / transport.disconnect land in `dumpLogs()`;
 *   2. every field is a PII-SAFE scalar — a byte COUNT or a route/error label only, NEVER the
 *      peer address (`to`) or the payload/envelope contents.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NknTransport } from '../src/index.js';
import { dumpLogs, clearLogs } from '@onderling/logger';

const PEER_ADDR = 'super-secret-peer.abcdef0123456789';   // must never be logged
const SECRET_ENVELOPE = { to: PEER_ADDR, body: 'private-message-CONTENT-do-not-log' };

const ALLOWED_KEYS = new Set(['multi', 'seeded', 'bytes', 'err', 'transient', 'reason']);
const FORBIDDEN = ['super-secret', 'peer', 'CONTENT', 'private-message', 'abcdef', PEER_ADDR];

function assertPiiSafe(records) {
  for (const r of records.filter(r => r.tag === 'transport')) {
    if (!r.f) continue;
    for (const [k, v] of Object.entries(r.f)) {
      expect(ALLOWED_KEYS.has(k), `unexpected field key "${k}" in ${r.tag}/${r.code}`).toBe(true);
      expect(['number', 'boolean', 'string']).toContain(typeof v);
      if (typeof v === 'string') {
        for (const bad of FORBIDDEN) {
          expect(v.toLowerCase().includes(String(bad).toLowerCase()), `field ${k}="${v}" leaks "${bad}"`).toBe(false);
        }
      }
    }
  }
}

const identity = { pubKeyBytes: new Uint8Array([1, 2, 3, 4]) };

/** Minimal fake nkn.Client — fires 'connect' on the next tick, records sends. */
function fakeNknLib({ sendImpl } = {}) {
  class FakeClient {
    constructor() { this.addr = PEER_ADDR; this.sent = []; this._h = {}; }
    on(evt, cb) { this._h[evt] = cb; if (evt === 'connect') setTimeout(() => cb(), 0); }
    async send(to, payload, _opts) {
      if (sendImpl) return sendImpl(to, payload);
      this.sent.push({ to, payload });
    }
    close() {}
  }
  return { Client: FakeClient };   // no MultiClient → single-client path
}

describe('NknTransport — logger coverage + PII-safety', () => {
  beforeEach(() => clearLogs());

  it('logs connect / send (byte count) / disconnect without the address or payload', async () => {
    const t = new NknTransport({ identity, nknLib: fakeNknLib() });
    await t.connect();
    await t._put(PEER_ADDR, SECRET_ENVELOPE);
    await t.disconnect();

    const codes = dumpLogs().filter(r => r.tag === 'transport').map(r => r.code);
    expect(codes).toContain('transport.connect');
    expect(codes).toContain('transport.send');
    expect(codes).toContain('transport.disconnect');

    const send = dumpLogs().find(r => r.code === 'transport.send');
    expect(send.f.bytes).toBe(JSON.stringify(SECRET_ENVELOPE).length);   // byte COUNT
    expect(Object.keys(send.f)).toEqual(['bytes']);                      // nothing else
    assertPiiSafe(dumpLogs());
  });

  it('logs transport.send.fail with the error NAME only on a non-transient failure', async () => {
    const boom = new RangeError('nkn exploded');
    const t = new NknTransport({ identity, nknLib: fakeNknLib({ sendImpl: async () => { throw boom; } }) });
    await t.connect();
    await expect(t._put(PEER_ADDR, SECRET_ENVELOPE)).rejects.toBe(boom);

    const fail = dumpLogs().find(r => r.code === 'transport.send.fail');
    expect(fail).toBeTruthy();
    expect(fail.f.err).toBe('RangeError');        // error NAME, not the message
    expect(fail.f.transient).toBe(false);
    assertPiiSafe(dumpLogs());
  });
});
