import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DailyDigest } from '../../src/scheduler/DailyDigest.js';

/**
 * Tests for Stream 4b — DailyDigest.
 *
 * Uses vi.useFakeTimers() and an injected `nextFireMsFn` so the
 * tests are deterministic without touching real wall clocks.  One
 * test exercises the *default* nextFireMsFn (the Intl-backed
 * implementation) but only asserts a coarse "next-fire is roughly
 * an hour away" range so it stays robust to small drift.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

describe('scheduler/DailyDigest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" to a known instant so default-impl assertions are
    // reproducible.  2026-04-30T17:00:00Z = 19:00 in Europe/Amsterdam
    // (CEST, UTC+2 — DST is in effect).
    vi.setSystemTime(new Date('2026-04-30T17:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() arms the next fire at the time returned by nextFireMsFn', async () => {
    const onFire = vi.fn();
    const nextFireMsFn = vi.fn(() => Date.now() + HOUR_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();

    expect(nextFireMsFn).toHaveBeenCalledTimes(1);
    expect(onFire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(onFire).toHaveBeenCalledTimes(1);

    d.stop();
  });

  it('stop() cancels a pending fire', async () => {
    const onFire = vi.fn();
    const d = new DailyDigest({
      tz: 'UTC',
      atLocal: '20:00',
      onFire,
      nextFireMsFn: () => Date.now() + HOUR_MS,
    });

    d.start();
    d.stop();

    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('start() called twice without stop is a no-op (single timer)', async () => {
    const onFire = vi.fn();
    const nextFireMsFn = vi.fn(() => Date.now() + HOUR_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();
    d.start();
    d.start();

    // nextFireMsFn called exactly once on arming.
    expect(nextFireMsFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    // Only one fire — no double-arming.
    expect(onFire).toHaveBeenCalledTimes(1);

    d.stop();
  });

  it('stop() before start() is a no-op (does not throw)', () => {
    const d = new DailyDigest({
      tz: 'UTC', atLocal: '20:00',
      onFire: () => {},
      nextFireMsFn: () => Date.now() + HOUR_MS,
    });
    expect(() => d.stop()).not.toThrow();
    // Can still start afterward.
    d.start();
    d.stop();
  });

  it('after firing, the timer re-arms via nextFireMsFn', async () => {
    const onFire = vi.fn();
    const nextFireMsFn = vi
      .fn()
      // First arm fires in 1 h; second arm fires in 24 h.
      .mockImplementationOnce(() => Date.now() + HOUR_MS)
      .mockImplementationOnce(() => Date.now() + DAY_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
    // Re-armed.
    expect(nextFireMsFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(onFire).toHaveBeenCalledTimes(2);

    d.stop();
  });

  it('fireNow() invokes onFire immediately and ignores the schedule', async () => {
    const onFire = vi.fn();
    const nextFireMsFn = vi.fn(() => Date.now() + DAY_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();

    await d.fireNow();
    expect(onFire).toHaveBeenCalledTimes(1);

    // The scheduled timer is still pending — fireNow does NOT
    // cancel or replace it.
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(onFire).toHaveBeenCalledTimes(2);

    d.stop();
  });

  it('fireNow() works without a prior start()', async () => {
    const onFire = vi.fn();
    const d = new DailyDigest({
      tz: 'UTC', atLocal: '20:00', onFire,
      nextFireMsFn: () => Date.now() + HOUR_MS,
    });
    await d.fireNow();
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('an onFire error is swallowed; the next fire is still armed', async () => {
    const errors  = [];
    const orig    = console.error;
    console.error = (...a) => errors.push(a);

    const onFire = vi
      .fn()
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockImplementationOnce(() => {});

    const nextFireMsFn = vi
      .fn()
      .mockImplementationOnce(() => Date.now() + HOUR_MS)
      .mockImplementationOnce(() => Date.now() + DAY_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
    // Re-armed despite the throw.
    expect(nextFireMsFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(onFire).toHaveBeenCalledTimes(2);

    d.stop();
    console.error = orig;
  });

  it('a rejected promise from onFire is swallowed; the next fire is still armed', async () => {
    const onFire = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('async-boom')))
      .mockImplementationOnce(() => Promise.resolve());

    const nextFireMsFn = vi
      .fn()
      .mockImplementationOnce(() => Date.now() + HOUR_MS)
      .mockImplementationOnce(() => Date.now() + DAY_MS);

    const d = new DailyDigest({ tz: 'UTC', atLocal: '20:00', onFire, nextFireMsFn });
    d.start();

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    // Let microtasks settle so the rejection is observed and the
    // re-arm runs.
    await vi.advanceTimersByTimeAsync(0);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(nextFireMsFn).toHaveBeenCalledTimes(2);

    d.stop();
  });

  it('defaults: tz = UTC, atLocal = 20:00 (constructor accepts {} + onFire)', async () => {
    const onFire = vi.fn();
    // Pin a known "now" — 2026-04-30T17:00:00Z.  20:00 UTC same
    // day is 3 hours away.
    const d = new DailyDigest({ onFire });
    d.start();

    // Should fire about 3 hours from now (default UTC, default 20:00).
    await vi.advanceTimersByTimeAsync(3 * HOUR_MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onFire).toHaveBeenCalledTimes(1);

    d.stop();
  });

  it('default nextFireMsFn: Europe/Amsterdam @ 19:00 local → next-fire is "today 20:00" (≈1 h away)', () => {
    // System time pinned at 2026-04-30T17:00:00Z which is 19:00
    // CEST (Europe/Amsterdam, UTC+2 in late April).  Next 20:00
    // local is 1 h away.  Allow generous slack so we don't depend
    // on the exact minute-precision of the inversion.
    const d = new DailyDigest({
      tz:      'Europe/Amsterdam',
      atLocal: '20:00',
      onFire:  () => {},
    });
    d.start();

    // Advance 30 minutes — should NOT have fired yet.
    const onFireSpy = vi.fn();
    // Re-build with a spy now that we just want to observe the
    // armed delay.
    d.stop();

    const observed = vi.fn();
    const dd = new DailyDigest({
      tz:      'Europe/Amsterdam',
      atLocal: '20:00',
      onFire:  observed,
    });
    dd.start();

    // 30 minutes in → not yet fired.
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(observed).not.toHaveBeenCalled();

    // 90 minutes in → MUST have fired (range 30–90 min per spec).
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(observed).toHaveBeenCalledTimes(1);

    dd.stop();
  });

  it('throws if onFire is missing', () => {
    expect(() => new DailyDigest({ tz: 'UTC', atLocal: '20:00' }))
      .toThrow(/onFire/);
  });
});
