/**
 * reachability — cache semantics with injectable clock.
 */

import { describe, it, expect } from 'vitest';
import { createReachabilityCache } from '../src/reachability.js';

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

describe('reachability cache', () => {
  it('pseudo-pod:// URIs always read as reachable', () => {
    const c = createReachabilityCache();
    expect(c.isReachable('pseudo-pod://anne/x')).toBe(true);
  });

  it('unknown targets default to reachable', () => {
    const c = createReachabilityCache();
    expect(c.isReachable('https://anne.pod')).toBe(true);
  });

  it('marks unreachable; fresh failure overrides default trust', () => {
    const cl = clock();
    const c = createReachabilityCache({ now: cl.now });
    c.markUnreachable('https://anne.pod');
    expect(c.isReachable('https://anne.pod')).toBe(false);
  });

  it('fresh success overrides a fresh failure', () => {
    const cl = clock();
    const c = createReachabilityCache({ ttlMs: 10_000, now: cl.now });
    c.markUnreachable('https://anne.pod');
    cl.advance(100);
    c.markReachable('https://anne.pod');
    expect(c.isReachable('https://anne.pod')).toBe(true);
  });

  it('staleness re-trusts after TTL elapses', () => {
    const cl = clock();
    const c = createReachabilityCache({ ttlMs: 10_000, now: cl.now });
    c.markUnreachable('https://anne.pod');
    expect(c.isReachable('https://anne.pod')).toBe(false);
    cl.advance(10_001);
    expect(c.isReachable('https://anne.pod')).toBe(true);
  });

  it('clear(target) drops a single entry', () => {
    const c = createReachabilityCache();
    c.markUnreachable('https://x');
    c.markUnreachable('https://y');
    c.clear('https://x');
    expect(c.isReachable('https://x')).toBe(true);
    expect(c.isReachable('https://y')).toBe(false);
  });

  it('clear() drops everything', () => {
    const c = createReachabilityCache();
    c.markUnreachable('https://x');
    c.markUnreachable('https://y');
    c.clear();
    expect(c.isReachable('https://x')).toBe(true);
    expect(c.isReachable('https://y')).toBe(true);
  });

  it('snapshot returns all entries', () => {
    const cl = clock();
    const c = createReachabilityCache({ now: cl.now });
    c.markReachable('https://x');
    c.markUnreachable('https://y');
    const s = c.snapshot();
    expect(s['https://x'].lastSuccess).toBeGreaterThan(0);
    expect(s['https://y'].lastFailure).toBeGreaterThan(0);
  });

  it('rejects bad targets silently (no throw)', () => {
    const c = createReachabilityCache();
    expect(c.isReachable(null)).toBe(false);
    expect(c.isReachable('')).toBe(false);
    c.markReachable(null);   // no-op
    c.markUnreachable('');   // no-op
  });
});
