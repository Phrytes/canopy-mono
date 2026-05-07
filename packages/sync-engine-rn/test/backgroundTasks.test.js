import { describe, it, expect, vi } from 'vitest';
import {
  defineBackgroundTask,
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  statusBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from '../index.js';

describe('defineBackgroundTask', () => {
  it('rejects missing args', () => {
    expect(() => defineBackgroundTask({})).toThrow(/TaskManager .* required/);
    expect(() => defineBackgroundTask({ TaskManager: {} })).toThrow(/taskName required/);
    expect(() => defineBackgroundTask({ TaskManager: {}, taskName: 'x' }))
      .toThrow(/runOnce/);
  });

  it('forwards the runOnce → newData when changes happened', async () => {
    const TaskManager = { defineTask: vi.fn() };
    const runOnce = vi.fn(async () => ({ uploads: 2, downloads: 0, deletes: 0, conflicts: 0 }));
    defineBackgroundTask({ TaskManager, taskName: 't', runOnce });
    expect(TaskManager.defineTask).toHaveBeenCalledOnce();
    const handler = TaskManager.defineTask.mock.calls[0][1];
    expect(await handler()).toBe('newData');
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it('returns noData when nothing changed', async () => {
    const TaskManager = { defineTask: vi.fn() };
    const runOnce = vi.fn(async () => ({ uploads: 0, downloads: 0, deletes: 0, conflicts: 0 }));
    defineBackgroundTask({ TaskManager, taskName: 't', runOnce });
    const handler = TaskManager.defineTask.mock.calls[0][1];
    expect(await handler()).toBe('noData');
  });

  it('returns failed when runOnce throws', async () => {
    const TaskManager = { defineTask: vi.fn() };
    const runOnce = vi.fn(async () => { throw new Error('boom'); });
    defineBackgroundTask({ TaskManager, taskName: 't', runOnce });
    const handler = TaskManager.defineTask.mock.calls[0][1];
    expect(await handler()).toBe('failed');
  });
});

describe('registerBackgroundFetch / unregister / status', () => {
  it('registers with the configured interval', async () => {
    const BackgroundFetch = {
      registerTaskAsync: vi.fn(async () => 'ok'),
    };
    await registerBackgroundFetch({
      BackgroundFetch, taskName: 'x', intervalSeconds: 600,
    });
    expect(BackgroundFetch.registerTaskAsync)
      .toHaveBeenCalledWith('x', { minimumInterval: 600, startOnBoot: true, stopOnTerminate: false });
  });

  it('default interval is 30 minutes', async () => {
    const BackgroundFetch = { registerTaskAsync: vi.fn() };
    await registerBackgroundFetch({ BackgroundFetch, taskName: 'x' });
    expect(BackgroundFetch.registerTaskAsync.mock.calls[0][1].minimumInterval)
      .toBe(DEFAULT_BACKGROUND_FETCH_INTERVAL_S);
    expect(DEFAULT_BACKGROUND_FETCH_INTERVAL_S).toBe(1800);
  });

  it('unregister rejects missing args', async () => {
    await expect(unregisterBackgroundFetch({}))
      .rejects.toThrow(/BackgroundFetch .* required/);
    await expect(unregisterBackgroundFetch({ BackgroundFetch: {} }))
      .rejects.toThrow(/taskName required/);
  });

  it('status returns whatever BackgroundFetch.getStatusAsync gives + isRegistered helper', async () => {
    const BackgroundFetch = {
      getStatusAsync: vi.fn(async () => 1),
      getRegisteredTasksAsync: vi.fn(async () => ['x', 'y']),
    };
    const r = await statusBackgroundFetch({ BackgroundFetch });
    expect(r.status).toBe(1);
    expect(await r.isRegistered('x')).toBe(true);
    expect(await r.isRegistered('z')).toBe(false);
  });
});
