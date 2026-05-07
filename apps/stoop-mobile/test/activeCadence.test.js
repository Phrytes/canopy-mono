/**
 * activeCadence — foreground/background ticker wiring.
 *
 * Uses Vitest fake timers so we can advance the wall clock without
 * waiting; AppState is a hand-rolled stub.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createActiveCadence, _internal } from '../src/lib/activeCadence.js';

function makeAppStateStub(initialState = 'active') {
  const listeners = new Set();
  return {
    currentState: initialState,
    addEventListener(evt, cb) {
      if (evt !== 'change') throw new Error('only "change" supported in stub');
      listeners.add(cb);
      return { remove: () => listeners.delete(cb) };
    },
    fire(next) {
      this.currentState = next;
      for (const cb of listeners) cb(next);
    },
    listenerCount: () => listeners.size,
  };
}

describe('createActiveCadence — input validation', () => {
  it('throws if runOnce is missing', () => {
    expect(() => createActiveCadence({ AppState: makeAppStateStub() }))
      .toThrow(/runOnce/);
  });
  it('throws if AppState is missing', () => {
    expect(() => createActiveCadence({ runOnce: async () => {} }))
      .toThrow(/AppState/);
  });
});

describe('createActiveCadence — ticking on foreground', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('starts ticking immediately when AppState is active', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    const c = createActiveCadence({ runOnce, AppState: App, getPollIntervalMs: () => 5000 });
    c.start();
    expect(c.isActive()).toBe(true);
    expect(c._state().ticking).toBe(true);

    vi.advanceTimersByTime(15_000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it('does not tick when started in background', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('background');
    const c = createActiveCadence({ runOnce, AppState: App });
    c.start();
    expect(c._state().ticking).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(runOnce).not.toHaveBeenCalled();
    c.stop();
  });

  it('starts ticking when app moves foreground', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('background');
    const c = createActiveCadence({ runOnce, AppState: App, getPollIntervalMs: () => 5000 });
    c.start();
    expect(c._state().ticking).toBe(false);

    App.fire('active');
    expect(c._state().ticking).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('stops ticking when app moves background', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    const c = createActiveCadence({ runOnce, AppState: App, getPollIntervalMs: () => 5000 });
    c.start();
    vi.advanceTimersByTime(5_000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    App.fire('background');
    expect(c._state().ticking).toBe(false);

    vi.advanceTimersByTime(50_000);
    expect(runOnce).toHaveBeenCalledTimes(1); // no further ticks
    c.stop();
  });
});

describe('createActiveCadence — refresh', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('changes ticking interval after refresh()', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    let interval = 5000;
    const c = createActiveCadence({
      runOnce,
      AppState: App,
      getPollIntervalMs: () => interval,
    });
    c.start();
    vi.advanceTimersByTime(10_000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    interval = 1000;
    c.refresh();
    runOnce.mockClear();
    vi.advanceTimersByTime(3_000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it('refresh() with same interval is a no-op', () => {
    const runOnce = vi.fn(async () => ({}));
    const App = makeAppStateStub('active');
    const c = createActiveCadence({
      runOnce,
      AppState: App,
      getPollIntervalMs: () => 5000,
    });
    c.start();
    const before = c._state();
    c.refresh();
    expect(c._state()).toEqual(before);
    c.stop();
  });
});

describe('createActiveCadence — error handling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('keeps ticking after a runOnce rejection', async () => {
    let calls = 0;
    const runOnce = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return {};
    });
    const errors = [];
    const App = makeAppStateStub('active');
    const c = createActiveCadence({
      runOnce,
      AppState: App,
      getPollIntervalMs: () => 5000,
      onError: (e) => errors.push(e),
    });
    c.start();
    vi.advanceTimersByTime(15_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(runOnce.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toBe('boom');
    c.stop();
  });
});

describe('createActiveCadence — teardown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('stop() removes the AppState subscription', () => {
    const App = makeAppStateStub('active');
    const c = createActiveCadence({
      runOnce: async () => {},
      AppState: App,
    });
    c.start();
    expect(App.listenerCount()).toBe(1);
    c.stop();
    expect(App.listenerCount()).toBe(0);
    expect(c.isActive()).toBe(false);
    expect(c._state().ticking).toBe(false);
  });

  it('start() / stop() are idempotent', () => {
    const App = makeAppStateStub('active');
    const c = createActiveCadence({
      runOnce: async () => {},
      AppState: App,
    });
    c.start(); c.start();
    expect(App.listenerCount()).toBe(1);
    c.stop(); c.stop();
    expect(App.listenerCount()).toBe(0);
  });
});

describe('_resolveInterval', () => {
  it('clamps below the minimum', () => {
    expect(_internal._resolveInterval(() => 50)).toBe(_internal.MIN_POLL_INTERVAL_MS);
  });
  it('falls back on non-numbers', () => {
    expect(_internal._resolveInterval(() => 'fast')).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
    expect(_internal._resolveInterval(() => null)).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
    expect(_internal._resolveInterval(() => NaN)).toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
  });
  it('falls back when the getter throws', () => {
    expect(_internal._resolveInterval(() => { throw new Error('x'); }))
      .toBe(_internal.DEFAULT_POLL_INTERVAL_MS);
  });
});
