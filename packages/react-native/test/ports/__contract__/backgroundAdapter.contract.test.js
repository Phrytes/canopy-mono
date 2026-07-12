/**
 * BackgroundAdapter port contract.
 *
 * Runs against the Mock AND the Expo concrete (with injected fake helpers, so
 * no `expo-*` native dep is needed).  A future `BackgroundAdapter.ios` /
 * `.android` (Slice 3) is "done" when it passes this suite.
 */
import { describe, it, expect, vi } from 'vitest';
import { MockBackgroundAdapter } from '../../../src/ports/mocks/MockBackgroundAdapter.js';
import { ExpoBackgroundAdapter } from '../../../src/ports/backgroundAdapters/ExpoBackgroundAdapter.js';

function runBackgroundAdapterContract(name, make) {
  describe(`BackgroundAdapter contract — ${name}`, () => {
    it('defineColdStartTask() accepts a handler (registers before engine boot)', () => {
      const a = make();
      const handler = vi.fn(async () => ({}));
      expect(() => a.defineColdStartTask(handler)).not.toThrow();
    });

    it('scheduleReconnect() resolves', async () => {
      const a = make();
      await expect(a.scheduleReconnect({ intervalSeconds: 60 })).resolves.not.toThrow;
    });

    it('onWake() returns an idempotent unsubscribe', () => {
      const a = make();
      const unsub = a.onWake(vi.fn());
      expect(typeof unsub).toBe('function');
      expect(() => { unsub(); unsub(); }).not.toThrow();
    });

    it('onAppStateChange() returns an idempotent unsubscribe', () => {
      const a = make();
      const unsub = a.onAppStateChange(vi.fn());
      expect(typeof unsub).toBe('function');
      expect(() => { unsub(); unsub(); }).not.toThrow();
    });

    it('teardown() is idempotent', async () => {
      const a = make();
      a.defineColdStartTask(vi.fn());
      a.onWake(vi.fn());
      a.onAppStateChange(vi.fn());
      await a.teardown();
      await expect(a.teardown()).resolves.not.toThrow;
    });
  });
}

// Mock
runBackgroundAdapterContract('MockBackgroundAdapter', () => new MockBackgroundAdapter());

// Expo concrete — inject fake today's-helpers so it's device-free.
function makeExpo() {
  const defineTask = vi.fn();
  return new ExpoBackgroundAdapter({
    deps: {
      registerBackgroundTask:   vi.fn(),
      setBgRunOnce:             vi.fn(),
      clearBgRunOnce:           vi.fn(),
      registerBackgroundFetch:  vi.fn(async () => ({ ok: true })),
      unregisterBackgroundFetch: vi.fn(async () => {}),
      attachAppStateBridge:     vi.fn(() => () => {}),
    },
    config: {
      taskName: 'contract-task',
      results: { NoData: 'noData', NewData: 'newData', Failed: 'failed' },
      TaskManager: { defineTask },
      BackgroundFetch: {},
      AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
      bundle: { agent: {}, cache: { setOnline: vi.fn() } },
    },
  });
}
runBackgroundAdapterContract('ExpoBackgroundAdapter', makeExpo);

// Extra: the Expo concrete really forwards to today's helpers (the "wrap").
describe('ExpoBackgroundAdapter — forwards to injected helpers (zero new logic)', () => {
  it('defineColdStartTask wires registerBackgroundTask + setBgRunOnce', () => {
    const registerBackgroundTask = vi.fn();
    const setBgRunOnce = vi.fn();
    const defineTask = vi.fn();
    const a = new ExpoBackgroundAdapter({
      deps: { registerBackgroundTask, setBgRunOnce },
      config: { taskName: 'T', results: {}, TaskManager: { defineTask } },
    });
    const handler = async () => ({});
    a.defineColdStartTask(handler);
    expect(registerBackgroundTask).toHaveBeenCalledWith({ taskName: 'T', defineTask, results: {} });
    expect(setBgRunOnce).toHaveBeenCalledWith(handler);
  });

  it('teardown clears the singleton + unregisters fetch + runs app-state cleanup', async () => {
    const clearBgRunOnce = vi.fn();
    const unregisterBackgroundFetch = vi.fn(async () => {});
    const appStateCleanup = vi.fn();
    const attachAppStateBridge = vi.fn(() => appStateCleanup);
    const a = new ExpoBackgroundAdapter({
      deps: { clearBgRunOnce, unregisterBackgroundFetch, attachAppStateBridge },
      config: { taskName: 'T', BackgroundFetch: {}, AppState: {}, bundle: { agent: {} } },
    });
    a.onAppStateChange(vi.fn());
    await a.teardown();
    expect(appStateCleanup).toHaveBeenCalled();
    expect(clearBgRunOnce).toHaveBeenCalled();
    expect(unregisterBackgroundFetch).toHaveBeenCalledWith({ BackgroundFetch: {}, taskName: 'T' });
  });
});
