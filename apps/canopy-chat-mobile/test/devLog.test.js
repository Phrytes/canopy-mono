/**
 * devLog — toggle / channel / global-shim semantics.
 *
 * Tests are deliberately exhaustive on the toggle behaviour because
 * the dev-log channel is the primary observability seam I use to
 * debug from the laptop without supervising every reload.  If the
 * toggle drifts, I lose that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  dlog, setDevLog, setDevLogChannel, getDevLogState,
} from '../src/core/devLog.js';

beforeEach(() => {
  setDevLog(true);
  for (const ch of ['boot', 'dispatch', 'render', 'button', 'warn']) {
    setDevLogChannel(ch, true);
  }
});

describe('devLog — master switch', () => {
  it('emits to console.log when enabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dlog.dispatch('foo', { bar: 1 });
    expect(spy).toHaveBeenCalledWith('[cc/dispatch]', 'foo', { bar: 1 });
    spy.mockRestore();
  });

  it('suppresses ALL channels when disabled', () => {
    setDevLog(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dlog.boot('x'); dlog.dispatch('y'); dlog.render('z');
    dlog.button('q'); dlog.warn('r');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore(); warn.mockRestore();
  });
});

describe('devLog — per-channel switch', () => {
  it('mutes one channel while leaving others speaking', () => {
    setDevLogChannel('dispatch', false);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dlog.dispatch('hidden');
    dlog.render('visible');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[cc/render]', 'visible');
    spy.mockRestore();
  });

  it('warn routes to console.warn even when enabled', () => {
    const log  = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dlog.warn('boom', { cause: 'demo' });
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[cc/warn]', 'boom', { cause: 'demo' });
    log.mockRestore(); warn.mockRestore();
  });

  it('unknown channels in setDevLogChannel are silently no-op (no throw)', () => {
    expect(() => setDevLogChannel('not-a-channel', false)).not.toThrow();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dlog.dispatch('still-on');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('devLog — getDevLogState snapshot', () => {
  it('returns a clone of the channel map (mutation does not leak)', () => {
    const s = getDevLogState();
    expect(s.enabled).toBe(true);
    expect(s.channels.dispatch).toBe(true);
    s.channels.dispatch = false;                 // try to mutate
    const s2 = getDevLogState();
    expect(s2.channels.dispatch).toBe(true);     // unaffected
  });
});

describe('devLog — global shim for Metro console', () => {
  it('exposes ccSetDevLog + ccSetDevLogChannel + ccGetDevLogState on globalThis', () => {
    expect(typeof globalThis.ccSetDevLog).toBe('function');
    expect(typeof globalThis.ccSetDevLogChannel).toBe('function');
    expect(typeof globalThis.ccGetDevLogState).toBe('function');
    // Round-trip through the global so Metro-console users see the
    // same effect as direct import.
    globalThis.ccSetDevLog(false);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dlog.dispatch('should be muted');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
