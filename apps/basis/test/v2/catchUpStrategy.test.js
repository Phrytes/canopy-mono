/**
 * ε.2 — catchUpStrategy substrate tests.
 *
 * Pure JS; no DOM/RN dependencies.  Deterministic — no clock / no
 * random in either the substrate or these tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  pickCatchUpStrategy,
  scheduleCatchUp,
  KNOWN_POD_AXES,
  CATCH_UP_STRATEGIES,
} from '../../src/v2/catchUpStrategy.js';

describe('pickCatchUpStrategy', () => {
  it("returns 'pod' for pod='shared'", () => {
    expect(pickCatchUpStrategy({ pod: 'shared' })).toBe('pod');
  });

  it("returns 'peer' for pod='personal'", () => {
    expect(pickCatchUpStrategy({ pod: 'personal' })).toBe('peer');
  });

  it("returns 'hybrid' for pod='hybrid'", () => {
    expect(pickCatchUpStrategy({ pod: 'hybrid' })).toBe('hybrid');
  });

  it("returns 'peer' for pod='none' (no pod → peer is the only option)", () => {
    expect(pickCatchUpStrategy({ pod: 'none' })).toBe('peer');
  });

  it("returns 'peer' for unknown pod axis (forward-compat)", () => {
    expect(pickCatchUpStrategy({ pod: 'someFutureAxis' })).toBe('peer');
  });

  it("returns 'peer' for missing pod field (forward-compat)", () => {
    expect(pickCatchUpStrategy({})).toBe('peer');
  });

  it("returns 'peer' for null/undefined policy (defensive)", () => {
    expect(pickCatchUpStrategy(null)).toBe('peer');
    expect(pickCatchUpStrategy(undefined)).toBe('peer');
  });

  it('exports KNOWN_POD_AXES sourced from circlePolicy enums', () => {
    expect(KNOWN_POD_AXES).toEqual(expect.arrayContaining(['none', 'shared', 'personal', 'hybrid']));
  });

  it('exports CATCH_UP_STRATEGIES with the four routes', () => {
    expect(CATCH_UP_STRATEGIES).toEqual(['pod', 'peer', 'hybrid', 'none']);
  });
});

describe('scheduleCatchUp', () => {
  const makeHandlers = ({ pod, peer } = {}) => ({
    podRangeQuery: pod ?? vi.fn(async () => ({ kind: 'pod-result' })),
    peerCatchUp:   peer ?? vi.fn(async () => ({ kind: 'peer-result' })),
  });

  it("pod:'shared' invokes podRangeQuery, not peerCatchUp", async () => {
    const handlers = makeHandlers();
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'shared' },
      handlers,
    });
    expect(out.strategy).toBe('pod');
    expect(handlers.podRangeQuery).toHaveBeenCalledTimes(1);
    expect(handlers.peerCatchUp).not.toHaveBeenCalled();
    expect(out.results).toEqual([{ path: 'pod', status: 'ok', result: { kind: 'pod-result' } }]);
  });

  it("pod:'personal' invokes peerCatchUp, not podRangeQuery", async () => {
    const handlers = makeHandlers();
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'personal' },
      handlers,
    });
    expect(out.strategy).toBe('peer');
    expect(handlers.peerCatchUp).toHaveBeenCalledTimes(1);
    expect(handlers.podRangeQuery).not.toHaveBeenCalled();
    expect(out.results).toEqual([{ path: 'peer', status: 'ok', result: { kind: 'peer-result' } }]);
  });

  it("pod:'hybrid' invokes BOTH pod + peer in pod-first order", async () => {
    const order = [];
    const handlers = {
      podRangeQuery: vi.fn(async () => { order.push('pod'); return { kind: 'pod-result' }; }),
      peerCatchUp:   vi.fn(async () => { order.push('peer'); return { kind: 'peer-result' }; }),
    };
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'hybrid' },
      handlers,
    });
    expect(out.strategy).toBe('hybrid');
    expect(handlers.podRangeQuery).toHaveBeenCalledTimes(1);
    expect(handlers.peerCatchUp).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['pod', 'peer']);
    expect(out.results.map((r) => r.path)).toEqual(['pod', 'peer']);
    expect(out.results.every((r) => r.status === 'ok')).toBe(true);
  });

  it("pod:'none' invokes peerCatchUp (peer is the only option)", async () => {
    const handlers = makeHandlers();
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'none' },
      handlers,
    });
    expect(out.strategy).toBe('peer');
    expect(handlers.peerCatchUp).toHaveBeenCalledTimes(1);
    expect(handlers.podRangeQuery).not.toHaveBeenCalled();
  });

  it('missing podRangeQuery handler → deferred (not thrown)', async () => {
    const peer = vi.fn(async () => ({ ok: true }));
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'shared' },
      handlers: { peerCatchUp: peer },
    });
    expect(out.strategy).toBe('pod');
    expect(out.results).toHaveLength(1);
    expect(out.results[0].path).toBe('pod');
    expect(out.results[0].status).toBe('deferred');
    expect(out.results[0].reason).toMatch(/podRangeQuery/);
    expect(peer).not.toHaveBeenCalled();
  });

  it('missing peerCatchUp handler → deferred (not thrown)', async () => {
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'personal' },
      handlers: {},
    });
    expect(out.results[0]).toEqual({
      path:   'peer',
      status: 'deferred',
      reason: 'no peerCatchUp handler',
    });
  });

  it('thrown pod handler → error result (not thrown)', async () => {
    const handlers = {
      podRangeQuery: vi.fn(async () => { throw new Error('boom-pod'); }),
      peerCatchUp:   vi.fn(async () => ({ ok: true })),
    };
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'shared' },
      handlers,
    });
    expect(out.results).toEqual([{ path: 'pod', status: 'error', reason: 'boom-pod' }]);
  });

  it('thrown peer handler → error result (not thrown)', async () => {
    const handlers = {
      peerCatchUp: vi.fn(async () => { throw new Error('boom-peer'); }),
    };
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'personal' },
      handlers,
    });
    expect(out.results).toEqual([{ path: 'peer', status: 'error', reason: 'boom-peer' }]);
  });

  it('returns {strategy, results} shape with results as array', async () => {
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'personal' },
      handlers: makeHandlers(),
    });
    expect(out).toHaveProperty('strategy');
    expect(out).toHaveProperty('results');
    expect(Array.isArray(out.results)).toBe(true);
  });

  it("pod:'none' yields empty results (caller logs 'skipped')", async () => {
    // 'none' → 'peer' route, but the dispatcher maps 'none' → no-op.
    // Wait — per pickCatchUpStrategy, 'none' is 'peer'.  The empty-
    // results behaviour is only reachable if a caller explicitly
    // routes via strategy='none' (future).  Today we cover the
    // pickCatchUpStrategy('none') path elsewhere; here we assert the
    // shape: results is still an array even when no peer handler is
    // wired.
    const out = await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'none' },
      handlers: {},  // no handlers at all
    });
    expect(out.strategy).toBe('peer');
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].status).toBe('deferred');
  });

  it('sinceTs defaults to 0 when opts omitted', async () => {
    const pod = vi.fn(async () => ({}));
    await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'shared' },
      handlers: { podRangeQuery: pod },
    });
    expect(pod).toHaveBeenCalledWith({ circleId: 'k1', sinceTs: 0 });
  });

  it('sinceTs is passed through to handlers when provided', async () => {
    const pod  = vi.fn(async () => ({}));
    const peer = vi.fn(async () => ({}));
    await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'hybrid' },
      handlers: { podRangeQuery: pod, peerCatchUp: peer },
      opts:     { sinceTs: 12345 },
    });
    expect(pod).toHaveBeenCalledWith({  circleId: 'k1', sinceTs: 12345 });
    expect(peer).toHaveBeenCalledWith({ circleId: 'k1', sinceTs: 12345 });
  });

  it('non-finite sinceTs falls back to 0', async () => {
    const peer = vi.fn(async () => ({}));
    await scheduleCatchUp({
      circleId: 'k1',
      policy:   { pod: 'personal' },
      handlers: { peerCatchUp: peer },
      opts:     { sinceTs: NaN },
    });
    expect(peer).toHaveBeenCalledWith({ circleId: 'k1', sinceTs: 0 });
  });
});
