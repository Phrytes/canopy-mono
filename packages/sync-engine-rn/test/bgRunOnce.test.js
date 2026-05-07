import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setBgRunOnce, clearBgRunOnce, bgRunOnce,
  registerBackgroundTask,
} from '../index.js';

describe('bgRunOnce — module-level engine bridge', () => {
  beforeEach(() => clearBgRunOnce());

  it('returns null when no engine is wired', async () => {
    expect(await bgRunOnce()).toBeNull();
  });

  it('forwards to the wired runOnce when set', async () => {
    const fn = vi.fn(async () => ({ uploads: 3 }));
    setBgRunOnce(fn);
    expect(await bgRunOnce()).toEqual({ uploads: 3 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('clearBgRunOnce disconnects', async () => {
    setBgRunOnce(async () => 'live');
    clearBgRunOnce();
    expect(await bgRunOnce()).toBeNull();
  });

  it('rejects non-function arg', () => {
    expect(() => setBgRunOnce(null)).toThrow(/function required/);
    expect(() => setBgRunOnce({})).toThrow(/function required/);
  });
});

describe('registerBackgroundTask — Expo TaskManager bridge', () => {
  beforeEach(() => clearBgRunOnce());

  const RESULTS = Object.freeze({
    NoData:  'no-data',
    NewData: 'new-data',
    Failed:  'failed',
  });

  it('defineTask is called with taskName + a handler', () => {
    const defineTask = vi.fn();
    registerBackgroundTask({ taskName: 'x', defineTask, results: RESULTS });
    expect(defineTask).toHaveBeenCalledOnce();
    expect(defineTask.mock.calls[0][0]).toBe('x');
    expect(typeof defineTask.mock.calls[0][1]).toBe('function');
  });

  it('handler returns NoData when no engine is wired', async () => {
    const defineTask = vi.fn();
    registerBackgroundTask({ taskName: 'x', defineTask, results: RESULTS });
    const handler = defineTask.mock.calls[0][1];
    expect(await handler()).toBe('no-data');
  });

  it('handler returns NewData when engine returns truthy', async () => {
    setBgRunOnce(async () => ({ uploads: 1 }));
    const defineTask = vi.fn();
    registerBackgroundTask({ taskName: 'x', defineTask, results: RESULTS });
    const handler = defineTask.mock.calls[0][1];
    expect(await handler()).toBe('new-data');
  });

  it('handler returns Failed when engine throws', async () => {
    setBgRunOnce(async () => { throw new Error('boom'); });
    const defineTask = vi.fn();
    registerBackgroundTask({ taskName: 'x', defineTask, results: RESULTS });
    const handler = defineTask.mock.calls[0][1];
    expect(await handler()).toBe('failed');
  });

  it('rejects missing args', () => {
    expect(() => registerBackgroundTask({}))
      .toThrow(/taskName required/);
    expect(() => registerBackgroundTask({ taskName: 'x' }))
      .toThrow(/defineTask required/);
    expect(() => registerBackgroundTask({ taskName: 'x', defineTask: () => {} }))
      .toThrow(/results enum required/);
  });
});
