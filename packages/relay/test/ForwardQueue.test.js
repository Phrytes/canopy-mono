/**
 * ForwardQueue tests — the single relay hold-and-forward owner (C5).
 *
 * Proves the ONE forward path behaves identically to the two brokers it
 * replaced: `server.js` (topic-aware, capped, timer-evicted, push-wake) and
 * `WsServerTransport` (single bucket, uncapped, lazy expiry-on-write). Both
 * emit the SAME `{type:'message', envelope}` wire frame.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForwardQueue } from '../src/ForwardQueue.js';

/** A fake socket that records every frame it is sent. */
function fakeSocket({ open = true } = {}) {
  return {
    readyState: open ? 1 : 3,
    sent:       [],
    send(raw) { this.sent.push(JSON.parse(raw)); },
  };
}

const env = (id) => ({ _v: 1, _p: 'OW', _id: id, payload: `p-${id}` });

describe('ForwardQueue — one owner, identical wire frame', () => {
  it('delivers to a live socket with the shared message frame', () => {
    const fq = new ForwardQueue({ ttlMs: 60_000 });
    const sock = fakeSocket();
    const outcome = fq.deliverOrEnqueue('a', env('1'), { socket: sock });

    expect(outcome).toBe('delivered');
    expect(sock.sent).toEqual([{ type: 'message', envelope: env('1') }]);
    expect(fq.size).toBe(0);
  });

  it('static messageFrame matches the delivered frame exactly', () => {
    const fq = new ForwardQueue({ ttlMs: 60_000 });
    const sock = fakeSocket();
    fq.deliverOrEnqueue('a', env('9'), { socket: sock });
    expect(JSON.stringify(sock.sent[0])).toBe(ForwardQueue.messageFrame(env('9')));
  });

  it('buffers for an offline recipient and replays on drain (register)', () => {
    const fq = new ForwardQueue({ ttlMs: 60_000 });
    expect(fq.deliverOrEnqueue('a', env('1'), { socket: null })).toBe('queued');
    expect(fq.deliverOrEnqueue('a', env('2'), { socket: fakeSocket({ open: false }) })).toBe('queued');
    expect(fq.size).toBe(2);

    const sock = fakeSocket();
    fq.drain('a', sock);
    expect(sock.sent).toEqual([
      { type: 'message', envelope: env('1') },
      { type: 'message', envelope: env('2') },
    ]);
    expect(fq.size).toBe(0); // buffer cleared after drain
  });

  it('fires onWake once per buffered delivery (server.js push-wake shape)', () => {
    const onWake = vi.fn();
    const fq = new ForwardQueue({ ttlMs: 60_000, onWake });
    fq.deliverOrEnqueue('a', env('1'), { socket: null });
    fq.deliverOrEnqueue('a', env('2'), { socket: null });
    fq.deliverOrEnqueue('a', env('3'), { socket: fakeSocket() }); // delivered → no wake
    expect(onWake).toHaveBeenCalledTimes(2);
    expect(onWake).toHaveBeenCalledWith('a');
  });

  it('topic-aware config caps each bucket independently (server.js shape)', () => {
    const fq = new ForwardQueue({ ttlMs: 60_000, topicAware: true, queueCap: 2, queueCapTotal: 100 });
    // 3 on topic X (cap 2 → oldest X evicted), 1 on topic Y (kept).
    fq.enqueue('a', env('x1'), 'X');
    fq.enqueue('a', env('x2'), 'X');
    fq.enqueue('a', env('y1'), 'Y');
    fq.enqueue('a', env('x3'), 'X');

    const sock = fakeSocket();
    fq.drain('a', sock);
    const ids = sock.sent.map(m => m.envelope._id);
    expect(ids).not.toContain('x1');          // oldest in bucket X evicted
    expect(ids).toEqual(expect.arrayContaining(['x2', 'x3', 'y1']));
    expect(ids).toHaveLength(3);
  });

  it('global safety valve caps total buffered per address', () => {
    const fq = new ForwardQueue({ ttlMs: 60_000, topicAware: true, queueCap: 100, queueCapTotal: 3 });
    for (let i = 0; i < 6; i++) fq.enqueue('a', env(`e${i}`), `t${i}`);
    expect(fq.size).toBe(3); // oldest FIFO-evicted down to the global cap
  });

  it('WsServerTransport shape: single bucket, expiry purged on write + at drain', () => {
    const now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fq = new ForwardQueue({ ttlMs: 100, topicAware: false, evictOnWrite: true });

    fq.enqueue('a', env('old'));                 // at = now
    spy.mockReturnValue(now + 200);              // 200ms later → 'old' expired
    fq.enqueue('a', env('fresh'));               // evictOnWrite drops 'old'
    expect(fq.size).toBe(1);

    const sock = fakeSocket();
    fq.drain('a', sock, { evictFirst: true });
    expect(sock.sent.map(m => m.envelope._id)).toEqual(['fresh']);
    spy.mockRestore();
  });

  it('evictExpired sweeps every address (server.js timer shape)', () => {
    const now = 2_000_000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fq = new ForwardQueue({ ttlMs: 100, topicAware: true });
    fq.enqueue('a', env('a1'), null);
    fq.enqueue('b', env('b1'), null);
    spy.mockReturnValue(now + 500);              // both expired
    fq.evictExpired();
    expect(fq.size).toBe(0);
    spy.mockRestore();
  });
});
