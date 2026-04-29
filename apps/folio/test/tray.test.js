/**
 * tray.test.js — smoke tests for `src/tray/index.js` and the per-OS drivers.
 *
 * No real tray rendering happens here — we mock the driver via the
 * `loadDriver` injection point and assert that:
 *
 *   1. statusToState() maps various /status payloads to the correct state.
 *   2. driverNameFor() returns the right driver per platform.
 *   3. The poll loop reads /status and updates the icon.
 *   4. Backoff: after 5 consecutive failures, the interval bumps from
 *      pollIntervalMs to backoffIntervalMs.
 *   5. Click handler opens the configured URL via the OS shell.
 *   6. The Linux/macOS drivers shell out to notify-send / osascript using
 *      the injected exec stub (proves the wiring; doesn't render anything).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  startTray,
  statusToState,
  driverNameFor,
  openUrl,
  STATES,
} from '../src/tray/index.js';
import { createDriver as createLinuxDriver } from '../src/tray/linux.js';
import { createDriver as createMacosDriver } from '../src/tray/macos.js';
import { createDriver as createWindowsDriver } from '../src/tray/windows.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mock driver that records every setIcon + click + destroy. */
function makeMockDriver() {
  const calls = { setIcon: [], destroyed: false };
  let onClickHandler = () => {};
  return {
    factory: async () => ({
      setIcon: (state) => { calls.setIcon.push(state); },
      onClick: (h)     => { onClickHandler = h; },
      destroy: ()      => { calls.destroyed = true; },
    }),
    calls,
    invokeClick: () => onClickHandler(),
  };
}

/** Mock fetch that returns a sequence of responses. */
function makeFetchSeq(responses) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return {
      ok:   r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    };
  });
}

async function flushTimers(ms) {
  await vi.advanceTimersByTimeAsync(ms);
}

// ─── 1. statusToState ───────────────────────────────────────────────────────

describe('statusToState — icon-state mapping', () => {
  it('uses explicit `state` field when present', () => {
    expect(statusToState({ state: 'idle'     })).toBe('idle');
    expect(statusToState({ state: 'active'   })).toBe('active');
    expect(statusToState({ state: 'conflict' })).toBe('conflict');
    expect(statusToState({ state: 'error'    })).toBe('error');
  });

  it('derives from booleans/counters when `state` is absent', () => {
    expect(statusToState({ syncing: true                       })).toBe('active');
    expect(statusToState({ syncing: false, conflicts: 2        })).toBe('conflict');
    expect(statusToState({ syncing: false, conflicts: 0, errors: 1 })).toBe('error');
    expect(statusToState({ syncing: false, conflicts: 0        })).toBe('idle');
    expect(statusToState({}                                    )).toBe('idle');
  });

  it('falls back to error for null / non-object inputs', () => {
    expect(statusToState(null)).toBe('error');
    expect(statusToState(undefined)).toBe('error');
    expect(statusToState('not-an-object')).toBe('error');
  });

  it('error trumps conflict trumps active', () => {
    expect(statusToState({ syncing: true, conflicts: 3, errors: 1 })).toBe('error');
    expect(statusToState({ syncing: true, conflicts: 3            })).toBe('conflict');
  });

  it('exposed STATES map matches the four documented states', () => {
    expect(Object.keys(STATES).sort()).toEqual(
      ['active', 'conflict', 'error', 'idle'],
    );
    expect(STATES.idle).toBe('sync-idle');
    expect(STATES.active).toBe('sync-active');
    expect(STATES.conflict).toBe('sync-conflict');
    expect(STATES.error).toBe('sync-error');
  });
});

// ─── 2. driverNameFor — OS dispatch ─────────────────────────────────────────

describe('driverNameFor — OS dispatch', () => {
  it('routes darwin to ./macos.js', () => {
    expect(driverNameFor('darwin')).toBe('./macos.js');
  });
  it('routes linux to ./linux.js', () => {
    expect(driverNameFor('linux')).toBe('./linux.js');
  });
  it('routes win32 to ./windows.js', () => {
    expect(driverNameFor('win32')).toBe('./windows.js');
  });
  it('falls back to linux for unknown OS', () => {
    expect(driverNameFor('aix')).toBe('./linux.js');
    expect(driverNameFor('freebsd')).toBe('./linux.js');
  });
});

// ─── 3. Poll loop drives setIcon ────────────────────────────────────────────

describe('startTray — polling loop', () => {
  it('polls /status and updates the icon according to the response', async () => {
    vi.useFakeTimers();
    const mock = makeMockDriver();
    const fetchSeq = makeFetchSeq([
      { body: { state: 'idle'     } },
      { body: { state: 'active'   } },
      { body: { state: 'conflict' } },
    ]);

    const handle = await startTray({
      statusUrl:        'http://localhost:8888/status',
      pollIntervalMs:   1000,
      backoffIntervalMs: 5000,
      backoffThreshold: 5,
      platform:         'linux',
      loadDriver:       async () => mock.factory,
      fetch:            fetchSeq,
    });

    // First setIcon happens synchronously at startup ('idle').
    expect(mock.calls.setIcon[0]).toBe(STATES.idle);

    // Tick 1: fetch resolves with state=idle (no change → no new setIcon).
    await flushTimers(1);
    // Tick 2: fetch state=active → setIcon('sync-active')
    await flushTimers(1000);
    // Tick 3: fetch state=conflict → setIcon('sync-conflict')
    await flushTimers(1000);

    expect(fetchSeq).toHaveBeenCalled();
    expect(mock.calls.setIcon).toContain(STATES.active);
    expect(mock.calls.setIcon).toContain(STATES.conflict);

    await handle.stop();
    expect(mock.calls.destroyed).toBe(true);
    vi.useRealTimers();
  });

  it('backs off from 5 s to 30 s after 5 consecutive failures', async () => {
    vi.useFakeTimers();
    const mock = makeMockDriver();
    const failures = Array(20).fill(new Error('network down'));
    const fetchSeq = makeFetchSeq(failures);

    const handle = await startTray({
      statusUrl:         'http://localhost:8888/status',
      pollIntervalMs:    100,
      backoffIntervalMs: 1000,
      backoffThreshold:  5,
      platform:          'linux',
      loadDriver:        async () => mock.factory,
      fetch:             fetchSeq,
    });

    // First 5 ticks at the fast interval — 5 × 100 ms.
    await flushTimers(5 * 100 + 5);
    expect(handle._diagnostics.consecutiveFails).toBeGreaterThanOrEqual(5);
    expect(handle._diagnostics.state).toBe('error');

    const callsAfterFastPhase = fetchSeq.mock.calls.length;
    expect(callsAfterFastPhase).toBeGreaterThanOrEqual(5);

    // Now we should be on the slow interval.  Advance 100 ms — should NOT poll.
    await flushTimers(100);
    expect(fetchSeq.mock.calls.length).toBe(callsAfterFastPhase);

    // Advance the rest of the slow interval — one more poll.
    await flushTimers(1000);
    expect(fetchSeq.mock.calls.length).toBe(callsAfterFastPhase + 1);

    await handle.stop();
    vi.useRealTimers();
  });

  it('recovers from error to idle when /status starts succeeding again', async () => {
    vi.useFakeTimers();
    const mock = makeMockDriver();
    const fetchSeq = makeFetchSeq([
      new Error('boom'),
      new Error('boom'),
      { body: { state: 'idle' } },
    ]);

    const handle = await startTray({
      statusUrl:        'http://localhost:8888/status',
      pollIntervalMs:   100,
      backoffIntervalMs: 5000,
      backoffThreshold: 5,
      platform:         'linux',
      loadDriver:       async () => mock.factory,
      fetch:            fetchSeq,
    });

    await flushTimers(1);                    // first poll: error
    expect(handle._diagnostics.state).toBe('error');
    await flushTimers(100);                  // second poll: error
    await flushTimers(100);                  // third poll: idle
    expect(handle._diagnostics.state).toBe('idle');
    expect(handle._diagnostics.consecutiveFails).toBe(0);

    await handle.stop();
    vi.useRealTimers();
  });
});

// ─── 4. Click → opens URL ───────────────────────────────────────────────────

describe('startTray — click opens URL', () => {
  it('default click handler invokes the openUrl helper', async () => {
    const mock = makeMockDriver();
    const onClick = vi.fn();
    const fetchSeq = makeFetchSeq([{ body: { state: 'idle' } }]);

    const handle = await startTray({
      statusUrl:  'http://localhost:8888/status',
      onClick,
      platform:   'linux',
      loadDriver: async () => mock.factory,
      fetch:      fetchSeq,
    });

    await mock.invokeClick();
    expect(onClick).toHaveBeenCalledTimes(1);

    await handle.stop();
  });

  it('openUrl shells out to xdg-open / open / start by platform', async () => {
    const seenLinux   = vi.fn((cmd, cb) => cb && cb(null));
    const seenDarwin  = vi.fn((cmd, cb) => cb && cb(null));
    const seenWindows = vi.fn((cmd, cb) => cb && cb(null));

    await openUrl('http://localhost:8888/', { platform: 'linux',  exec: seenLinux });
    await openUrl('http://localhost:8888/', { platform: 'darwin', exec: seenDarwin });
    await openUrl('http://localhost:8888/', { platform: 'win32',  exec: seenWindows });

    expect(seenLinux.mock.calls[0][0]).toMatch(/^xdg-open /);
    expect(seenDarwin.mock.calls[0][0]).toMatch(/^open /);
    expect(seenWindows.mock.calls[0][0]).toMatch(/^cmd /);

    expect(seenLinux.mock.calls[0][0]).toContain('http://localhost:8888/');
  });

  it('default click derives the open-URL from statusUrl', async () => {
    const mock = makeMockDriver();
    const fetchSeq = makeFetchSeq([{ body: { state: 'idle' } }]);

    const handle = await startTray({
      statusUrl:  'http://my-host:9999/status',
      platform:   'linux',
      loadDriver: async () => mock.factory,
      fetch:      fetchSeq,
    });
    expect(handle._diagnostics.clickUrl).toBe('http://my-host:9999/');
    await handle.stop();
  });
});

// ─── 5. Per-OS driver smoke tests ───────────────────────────────────────────

describe('linux driver — shells out to notify-send', () => {
  it('sends a notification with the icon path', async () => {
    const calls = [];
    const exec  = (cmd, cb) => { calls.push(cmd); cb(null); };

    const drv = await createLinuxDriver({
      iconsDir: new URL('file:///tmp/icons/'),
      exec,
    });
    await drv.setIcon('sync-active');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^notify-send /);
    expect(calls[0]).toContain('sync-active');
    expect(calls[0]).toContain('--icon=');
    await drv.destroy();
  });

  it('does not throw when notify-send is missing (logs instead)', async () => {
    const exec = (cmd, cb) => cb(new Error('command not found: notify-send'));
    const drv  = await createLinuxDriver({ exec });
    await expect(drv.setIcon('sync-error')).resolves.toBeUndefined();
    await drv.destroy();
  });

  it('skips repeated identical states (no double-notification)', async () => {
    const calls = [];
    const exec  = (cmd, cb) => { calls.push(cmd); cb(null); };
    const drv   = await createLinuxDriver({ exec });
    await drv.setIcon('sync-idle');
    await drv.setIcon('sync-idle');
    await drv.setIcon('sync-idle');
    expect(calls).toHaveLength(1);
    await drv.destroy();
  });

  it('triggerClick invokes the registered click handler', async () => {
    const drv = await createLinuxDriver({ exec: (_c, cb) => cb(null) });
    const handler = vi.fn();
    drv.onClick(handler);
    drv.triggerClick();
    expect(handler).toHaveBeenCalledTimes(1);
    await drv.destroy();
  });
});

describe('macos driver — shells out to osascript', () => {
  it('runs osascript with display-notification', async () => {
    const calls = [];
    const exec  = (cmd, cb) => { calls.push(cmd); cb(null); };
    const drv   = await createMacosDriver({ exec });
    await drv.setIcon('sync-conflict');
    expect(calls[0]).toMatch(/^osascript /);
    expect(calls[0]).toContain('display notification');
    expect(calls[0]).toContain('Folio');
    await drv.destroy();
  });
});

describe('windows driver — stub', () => {
  it('does not throw and matches the driver interface', async () => {
    // Suppress the stub's startup console.log spam.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const drv = await createWindowsDriver();
    await drv.setIcon('sync-idle');
    drv.onClick(() => {});
    drv.triggerClick();
    await drv.destroy();
    spy.mockRestore();
  });
});
