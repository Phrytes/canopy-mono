/**
 * tray.test.js — Folio.B1.tray v2.7 unit tests.
 *
 * The persistent tray icon is backed by `systray2` (prebuilt Go binary).
 * To keep CI hermetic we mock systray2 at the module boundary — the
 * `loadSystray` injection point on `startTray()` accepts a class that
 * mirrors the systray2 surface (constructor + `ready` / `onClick` /
 * `sendAction` / `kill`).  No real binary is launched.
 *
 * What this file covers (≥8 unit tests required):
 *   1. statusToState() maps various /status payloads to the correct state
 *      (idle / active / conflict / error).
 *   2. driverNameFor() OS dispatch (legacy export — still used by the
 *      driver-mode harness for ./{linux,macos,windows}.js shims).
 *   3. headerText() — "synced X minutes ago" / "never synced" / "error".
 *   4. buildMenu() — shape: header + 3 actions + separator + sync/pause +
 *      separator + conflicts (+submenu) + separator + Quit.  Pause/Resume
 *      label flips with `watching`.  Quit always present.
 *   5. Real-mode startTray() boots the mocked SysTray class and pushes
 *      menu updates.
 *   6. Poll loop: status changes flow through to the menu icon and header.
 *   7. Backoff: 30 s after 5 consecutive failures.
 *   8. Click-action wiring:
 *      - "Sync now" → POST /sync/now
 *      - "Pause sync" / "Resume sync" → POST /watch/{stop,start}
 *      - "Open Folio" → openUrl(<base>)
 *      - "Open notes folder" → openFolder(localRoot)
 *      - "Recent conflicts (N)" → openUrl(<base>/#conflicts)
 *      - "Quit Folio" → POST /shutdown with X-Folio-Shutdown: true
 *   9. Driver-mode (legacy) keeps working: setIcon('sync-active') is called.
 *  10. Per-OS driver shims (./linux.js, ./macos.js, ./windows.js) match
 *      the historical interface (smoke).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  startTray,
  statusToState,
  driverNameFor,
  buildMenu,
  headerText,
  openUrl,
  ITEM_IDS,
  STATES,
} from '../src/tray/index.js';
import { createDriver as createLinuxDriver } from '../src/tray/linux.js';
import { createDriver as createMacosDriver } from '../src/tray/macos.js';
import { createDriver as createWindowsDriver } from '../src/tray/windows.js';

// ─── Mock systray2 ─────────────────────────────────────────────────────────

/**
 * MockSysTray — duck-typed against systray2's SysTray.
 *
 *   - constructor({ menu, debug }) — captures the initial menu
 *   - .ready() — resolves on next tick (mimics the helper-process boot)
 *   - .onClick(handler) — stash; tests fire it via .__simulateClick()
 *   - .sendAction({ type: 'update-menu', menu }) — replaces the captured menu
 *   - .kill(exitNode) — flips a flag
 */
function makeMockSysTrayClass(captured = {}) {
  class MockSysTray {
    constructor(conf) {
      captured.constructed = true;
      captured.initialMenu = conf?.menu ?? null;
      captured.menu        = conf?.menu ?? null;
      this._clickHandler   = null;
      this._killed         = false;
    }
    async ready() { /* immediate */ }
    async onClick(h) { this._clickHandler = h; }
    async sendAction(action) {
      captured.lastAction = action;
      if (action.type === 'update-menu') captured.menu = action.menu;
      if (action.type === 'update-item') captured.lastItem = action.item;
    }
    async kill(_exitNode) { this._killed = true; captured.killed = true; }
    async __simulateClick(folioId) {
      const items = (captured.menu?.items ?? []).flatMap((it) => [it, ...(it.items ?? [])]);
      const item  = items.find((it) => it && it.__folioId === folioId) ?? { __folioId: folioId };
      if (this._clickHandler) await this._clickHandler({ type: 'clicked', item });
    }
  }
  return { MockSysTray, captured };
}

/** Sequenceable fetch: returns the i-th response (or repeats the last). */
function makeFetchSeq(responses) {
  let i = 0;
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return {
      ok:      r.ok ?? true,
      status:  r.status ?? 200,
      json:    async () => r.body ?? {},
    };
  });
  fn.__calls = calls;
  return fn;
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

  it('handles the v2+ /status shape (pending.conflicts + lastError)', () => {
    expect(statusToState({ pending: { conflicts: 0 }, lastError: null   })).toBe('idle');
    expect(statusToState({ pending: { conflicts: 3 }, lastError: null   })).toBe('conflict');
    expect(statusToState({ pending: { conflicts: 0 }, lastError: { msg: 'boom' } })).toBe('error');
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

  it('STATES map matches the four documented states', () => {
    expect(Object.keys(STATES).sort()).toEqual(
      ['active', 'conflict', 'error', 'idle'],
    );
    expect(STATES.idle).toBe('sync-idle');
    expect(STATES.active).toBe('sync-active');
    expect(STATES.conflict).toBe('sync-conflict');
    expect(STATES.error).toBe('sync-error');
  });
});

// ─── 2. driverNameFor ──────────────────────────────────────────────────────

describe('driverNameFor — legacy OS dispatch', () => {
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

// ─── 3. headerText ─────────────────────────────────────────────────────────

describe('headerText — menu header line', () => {
  const NOW = new Date('2026-04-29T12:00:00Z').getTime();
  it('"never synced" when lastSyncAt is null', () => {
    expect(headerText('idle', null, NOW)).toBe('Folio — never synced');
  });
  it('"error" when state is error', () => {
    expect(headerText('error', NOW - 60_000, NOW)).toBe('Folio — error');
  });
  it('"just now" when sync is < 60 s old', () => {
    expect(headerText('idle', NOW - 5_000, NOW)).toBe('Folio — synced just now');
  });
  it('"N minutes ago" between 1 and 59 minutes', () => {
    expect(headerText('idle', NOW - 7 * 60_000, NOW)).toBe('Folio — synced 7 minutes ago');
    expect(headerText('idle', NOW - 1 * 60_000, NOW)).toBe('Folio — synced 1 minute ago');
  });
  it('"N hours ago" between 1 and 23 hours', () => {
    expect(headerText('idle', NOW - 3 * 3_600_000, NOW)).toBe('Folio — synced 3 hours ago');
  });
  it('"N days ago" beyond 24 h', () => {
    expect(headerText('idle', NOW - 2 * 86_400_000, NOW)).toBe('Folio — synced 2 days ago');
  });
});

// ─── 4. buildMenu ──────────────────────────────────────────────────────────

describe('buildMenu — menu shape', () => {
  it('produces header + open-folder + open-folio + sep + sync/pause + sep + conflicts + sep + quit', () => {
    const m = buildMenu({
      state: 'idle', lastSyncAt: null, watching: true, conflicts: [], iconBase64: '',
    });
    const ids = m.items.map((it) => it.__folioId ?? it.title);
    expect(ids).toContain(ITEM_IDS.HEADER);
    expect(ids).toContain(ITEM_IDS.OPEN_FOLDER);
    expect(ids).toContain(ITEM_IDS.OPEN_FOLIO);
    expect(ids).toContain(ITEM_IDS.SYNC_NOW);
    expect(ids).toContain(ITEM_IDS.PAUSE_RESUME);
    expect(ids).toContain(ITEM_IDS.CONFLICTS);
    expect(ids).toContain(ITEM_IDS.QUIT);
    // At least 3 separators between blocks.
    const seps = m.items.filter((it) => it.title === '<SEPARATOR>');
    expect(seps.length).toBeGreaterThanOrEqual(3);
  });

  it('"Pause sync" when watching, "Resume sync" when paused', () => {
    const onItem = (m) => m.items.find((it) => it.__folioId === ITEM_IDS.PAUSE_RESUME);
    expect(onItem(buildMenu({ state: 'idle', watching: true,  conflicts: [], iconBase64: '' })).title)
      .toBe('Pause sync');
    expect(onItem(buildMenu({ state: 'idle', watching: false, conflicts: [], iconBase64: '' })).title)
      .toBe('Resume sync');
  });

  it('conflicts submenu surfaces up to 5; disabled when 0', () => {
    const empty = buildMenu({ state: 'idle', watching: true, conflicts: [], iconBase64: '' });
    const cEmpty = empty.items.find((it) => it.__folioId === ITEM_IDS.CONFLICTS);
    expect(cEmpty.title).toBe('Recent conflicts (0)');
    expect(cEmpty.enabled).toBe(false);

    const seven = buildMenu({
      state: 'conflict', watching: true, iconBase64: '',
      conflicts: Array.from({ length: 7 }, (_, i) => ({ relPath: `file${i}.md` })),
    });
    const c7 = seven.items.find((it) => it.__folioId === ITEM_IDS.CONFLICTS);
    expect(c7.title).toBe('Recent conflicts (7)');
    expect(c7.enabled).toBe(true);
    expect(c7.items).toHaveLength(5); // capped at 5
    expect(c7.items[0].title).toBe('file0.md');
  });

  it('header item is disabled (status display only)', () => {
    const m = buildMenu({ state: 'idle', watching: true, conflicts: [], iconBase64: '' });
    const h = m.items.find((it) => it.__folioId === ITEM_IDS.HEADER);
    expect(h.enabled).toBe(false);
  });
});

// ─── 5. Real-mode startTray boots mocked SysTray ───────────────────────────

describe('startTray — real-mode (mocked SysTray)', () => {
  it('constructs the SysTray and seeds the initial menu', async () => {
    vi.useFakeTimers();
    const { MockSysTray, captured } = makeMockSysTrayClass();
    const fetchSeq = makeFetchSeq([{ body: { state: 'idle', watching: true, lastSyncAt: null } }]);

    const handle = await startTray({
      statusUrl:        'http://127.0.0.1:8888/status',
      pollIntervalMs:   1000,
      backoffIntervalMs: 5000,
      backoffThreshold: 5,
      loadSystray:      async () => MockSysTray,
      fetch:            fetchSeq,
    });

    expect(captured.constructed).toBe(true);
    expect(captured.initialMenu).toBeTruthy();
    // First poll happens on next tick; advance just past 0 ms.
    await flushTimers(1);
    // The menu has been refreshed at least once.
    expect(captured.lastAction?.type).toBe('update-menu');
    await handle.stop();
    expect(captured.killed).toBe(true);
    vi.useRealTimers();
  });
});

// ─── 6. Poll loop ──────────────────────────────────────────────────────────

describe('startTray — polling loop', () => {
  it('updates the menu icon as /status flips between states', async () => {
    vi.useFakeTimers();
    const { MockSysTray, captured } = makeMockSysTrayClass();
    const fetchSeq = makeFetchSeq([
      { body: { state: 'idle',     watching: true, lastSyncAt: null } },
      { body: { state: 'active',   watching: true, lastSyncAt: null } },
      { body: { state: 'conflict', watching: true, lastSyncAt: null,
                openConflictFiles: 2 } },
    ]);

    const handle = await startTray({
      statusUrl:        'http://127.0.0.1:8888/status',
      pollIntervalMs:   1000,
      backoffIntervalMs: 5000,
      backoffThreshold: 5,
      loadSystray:      async () => MockSysTray,
      fetch:            fetchSeq,
    });

    await flushTimers(1);     // first poll: idle
    await flushTimers(1000);  // second poll: active
    expect(handle._diagnostics.state).toBe('active');
    await flushTimers(1000);  // third poll: conflict
    expect(handle._diagnostics.state).toBe('conflict');
    expect(handle._diagnostics.conflicts.length).toBeGreaterThan(0);

    // Confirm the conflicts submenu reflects the count (up to 5).
    const c = captured.menu?.items?.find((it) => it.__folioId === ITEM_IDS.CONFLICTS);
    expect(c.title).toMatch(/^Recent conflicts \(\d+\)$/);

    await handle.stop();
    vi.useRealTimers();
  });
});

// ─── 7. Back-off ──────────────────────────────────────────────────────────

describe('startTray — backoff', () => {
  it('switches to the slow interval after 5 consecutive failures', async () => {
    vi.useFakeTimers();
    const { MockSysTray } = makeMockSysTrayClass();
    const fetchSeq = makeFetchSeq(Array(20).fill(new Error('network down')));

    const handle = await startTray({
      statusUrl:         'http://127.0.0.1:8888/status',
      pollIntervalMs:    100,
      backoffIntervalMs: 1000,
      backoffThreshold:  5,
      loadSystray:       async () => MockSysTray,
      fetch:             fetchSeq,
    });

    await flushTimers(5 * 100 + 5);
    expect(handle._diagnostics.consecutiveFails).toBeGreaterThanOrEqual(5);
    expect(handle._diagnostics.state).toBe('error');

    const callsAfterFastPhase = fetchSeq.__calls.length;
    expect(callsAfterFastPhase).toBeGreaterThanOrEqual(5);

    // Now we should be on the slow interval.
    await flushTimers(100);
    expect(fetchSeq.__calls.length).toBe(callsAfterFastPhase);

    await flushTimers(1000);
    expect(fetchSeq.__calls.length).toBe(callsAfterFastPhase + 1);

    await handle.stop();
    vi.useRealTimers();
  });
});

// ─── 8. Click-action wiring ────────────────────────────────────────────────

describe('startTray — menu-action wiring', () => {
  async function makeHarness({ watching = true, conflicts = [], openUrlImpl, openFolderImpl } = {}) {
    vi.useFakeTimers();
    const { MockSysTray, captured } = makeMockSysTrayClass();
    const fetchSeq = makeFetchSeq([{
      body: { state: 'idle', watching, lastSyncAt: null,
              openConflictFiles: conflicts.length },
    }]);

    const handle = await startTray({
      statusUrl:        'http://127.0.0.1:8888/status',
      openUrl:          'http://127.0.0.1:8888',
      localRoot:        '/home/me/notes',
      pollIntervalMs:   60_000,   // long, so the first poll is the only one
      backoffIntervalMs: 60_000,
      backoffThreshold: 5,
      loadSystray:      async () => MockSysTray,
      fetch:            fetchSeq,
      openUrlImpl:      openUrlImpl ?? vi.fn(async () => {}),
      openFolderImpl:   openFolderImpl ?? vi.fn(async () => {}),
    });

    // Resolve the first poll so the menu reflects `watching` / conflicts.
    await flushTimers(1);

    // Pull the live MockSysTray instance out for click simulation.
    const sysTray = handle._diagnostics.sysTray;
    return { handle, sysTray, captured, fetchSeq };
  }

  it('"Sync now" → POST /sync/now', async () => {
    const h = await makeHarness();
    await h.sysTray.__simulateClick(ITEM_IDS.SYNC_NOW);

    const post = h.fetchSeq.__calls.find((c) => c.url.endsWith('/sync/now'));
    expect(post).toBeTruthy();
    expect(post.init?.method).toBe('POST');
    await h.handle.stop();
    vi.useRealTimers();
  });

  it('"Pause sync" → POST /watch/stop, "Resume sync" → POST /watch/start', async () => {
    // Watching=true → menu says "Pause sync" → click triggers /watch/stop
    const a = await makeHarness({ watching: true });
    await a.sysTray.__simulateClick(ITEM_IDS.PAUSE_RESUME);
    const stop = a.fetchSeq.__calls.find((c) => c.url.endsWith('/watch/stop'));
    expect(stop).toBeTruthy();
    await a.handle.stop();
    vi.useRealTimers();

    // Watching=false → menu says "Resume sync" → click triggers /watch/start
    const b = await makeHarness({ watching: false });
    await b.sysTray.__simulateClick(ITEM_IDS.PAUSE_RESUME);
    const start = b.fetchSeq.__calls.find((c) => c.url.endsWith('/watch/start'));
    expect(start).toBeTruthy();
    await b.handle.stop();
    vi.useRealTimers();
  });

  it('"Open Folio" → openUrlImpl(<base>)', async () => {
    const openUrlImpl = vi.fn(async () => {});
    const h = await makeHarness({ openUrlImpl });
    await h.sysTray.__simulateClick(ITEM_IDS.OPEN_FOLIO);
    expect(openUrlImpl).toHaveBeenCalledWith('http://127.0.0.1:8888');
    await h.handle.stop();
    vi.useRealTimers();
  });

  it('"Open notes folder" → openFolderImpl(localRoot)', async () => {
    const openFolderImpl = vi.fn(async () => {});
    const h = await makeHarness({ openFolderImpl });
    await h.sysTray.__simulateClick(ITEM_IDS.OPEN_FOLDER);
    expect(openFolderImpl).toHaveBeenCalledWith('/home/me/notes');
    await h.handle.stop();
    vi.useRealTimers();
  });

  it('"Recent conflicts" → openUrlImpl(<base>/#conflicts)', async () => {
    const openUrlImpl = vi.fn(async () => {});
    const h = await makeHarness({ conflicts: [{ relPath: 'a.md' }], openUrlImpl });
    await h.sysTray.__simulateClick(ITEM_IDS.CONFLICTS);
    expect(openUrlImpl).toHaveBeenCalledWith('http://127.0.0.1:8888/#conflicts');
    await h.handle.stop();
    vi.useRealTimers();
  });

  it('"Quit Folio" → POST /shutdown with X-Folio-Shutdown: true', async () => {
    const h = await makeHarness();
    await h.sysTray.__simulateClick(ITEM_IDS.QUIT);

    const post = h.fetchSeq.__calls.find((c) => c.url.endsWith('/shutdown'));
    expect(post).toBeTruthy();
    expect(post.init?.method).toBe('POST');
    expect(post.init?.headers?.['X-Folio-Shutdown']).toBe('true');
    expect(h.sysTray._killed).toBe(true);
    await h.handle.stop();
    vi.useRealTimers();
  });
});

// ─── 9. Driver-mode (legacy harness) — proves backwards compat ─────────────

describe('startTray — driver-mode (legacy)', () => {
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

  it('still maps /status to setIcon() when loadDriver is provided', async () => {
    vi.useFakeTimers();
    const mock = makeMockDriver();
    const fetchSeq = makeFetchSeq([
      { body: { state: 'idle' } },
      { body: { state: 'active' } },
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

    expect(mock.calls.setIcon[0]).toBe(STATES.idle);
    await flushTimers(1);
    await flushTimers(1000);
    expect(mock.calls.setIcon).toContain(STATES.active);

    await handle.stop();
    expect(mock.calls.destroyed).toBe(true);
    vi.useRealTimers();
  });
});

// ─── 10. Per-OS driver shims — backwards-compat smoke ──────────────────────

describe('linux driver shim — shells out to notify-send', () => {
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

describe('macos driver shim — shells out to osascript', () => {
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

describe('windows driver shim', () => {
  it('does not throw and matches the driver interface', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const drv = await createWindowsDriver();
    await drv.setIcon('sync-idle');
    drv.onClick(() => {});
    drv.triggerClick();
    await drv.destroy();
    spy.mockRestore();
  });
});

// ─── 11. openUrl helper (kept for backwards compat) ────────────────────────

describe('openUrl — OS shell-out', () => {
  it('shells out to xdg-open / open / start by platform', async () => {
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
});
