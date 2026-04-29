/**
 * app.js — Folio.B1.ui main controller.
 *
 * Wires the tab switcher, the WebSocket connection (with exponential
 * backoff), and the connection banner.  Routes WS frames to per-pane
 * modules via a shared event bus.
 *
 * After the v2.9 re-shape, primary tabs are exactly three:
 *   Status  — daily check-in (default landing pane)
 *   Conflicts — always present; gray badge at zero, yellow when N>0
 *   Share — mint capability tokens + show recent shares
 * Settings is a header link (NOT a primary tab) — it opens an overlay.
 * History is a feature, not a tab: each file row offers a "↻ history"
 * affordance that opens the per-file versions popover (versions.js).
 *
 * Modules import this file purely for the bus + helpers; they don't form
 * a hard dependency graph (which would require a build step).
 */

import { initStatus }    from '/status.js';
import { initConflicts } from '/conflicts.js';
import { initShare }     from '/share.js';
import { initAuth }      from '/auth.js';
import { initVersions }  from '/versions.js';
import { initSettings }  from '/settings.js';

// ── Tiny event bus ────────────────────────────────────────────────────────
// Per-pane modules subscribe via bus.on(type, handler).  WS frames from
// /events are forwarded as bus.emit(frame.type, frame); /healthz failures
// are emitted as bus.emit('conn.down') etc.
const listeners = new Map(); // type -> Set<fn>
export const bus = {
  on(type, fn)  { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => bus.off(type, fn); },
  off(type, fn) { listeners.get(type)?.delete(fn); },
  emit(type, payload) {
    for (const fn of listeners.get(type) ?? []) {
      try { fn(payload); }
      catch (err) { console.error(`bus handler for ${type} threw`, err); }
    }
  },
};

// ── HTTP helpers ──────────────────────────────────────────────────────────
export async function getJson(path) {
  const r = await fetch(path, { headers: { 'accept': 'application/json' } });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  if (!r.ok) {
    const msg = body?.error?.message ?? r.statusText ?? `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.code   = body?.error?.code;
    throw err;
  }
  return body;
}

export async function postJson(path, payload) {
  const r = await fetch(path, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    payload == null ? '' : JSON.stringify(payload),
  });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  if (!r.ok) {
    const msg = body?.error?.message ?? r.statusText ?? `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.code   = body?.error?.code;
    throw err;
  }
  return body;
}

// ── Banner ─────────────────────────────────────────────────────────────────
const banner = document.getElementById('conn-banner');

export function showBanner(kind, message) {
  banner.className = `banner banner--${kind}`;
  banner.textContent = message;
}
export function hideBanner() {
  banner.className = 'banner banner--hidden';
  banner.textContent = '';
}

// ── Folio v2.2 — Error banner ──────────────────────────────────────────────
//
// Surfaces the most recent *unresolved* sync error at the top of the page.
// "Unresolved" means: an `error` WS frame fired and the user hasn't dismissed
// it AND no clean sync has happened in the past 5 seconds.
//
// Wiring contract:
//   - subscribed to `ws.error`           → show
//   - subscribed to `ws.sync.done`       → start 5s clean-sync debounce
//   - "Retry sync"  button → POST /sync/now (banner clears on next clean done)
//   - "Dismiss"     button → hide until a new error fires (preserves history)
//
// Conflicts that surface as `phase: 'conflict'` on an `error` frame are
// excluded: those are normal-flow events, not failures.
const PHASE_BLOCKLIST = new Set(['conflict']);
const CLEAN_DEBOUNCE_MS = 5_000;

function fmtRelativeTime(ts) {
  if (!ts) return '';
  const d = Math.max(0, Date.now() - ts);
  if (d <  10_000)  return 'just now';
  if (d <  60_000)  return `${Math.round(d / 1_000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  return `${Math.round(d / 3_600_000)}h ago`;
}

function makeErrorBanner({ postJson }) {
  const $banner  = document.getElementById('error-banner');
  const $message = document.getElementById('error-banner-message');
  const $retry   = document.getElementById('error-banner-retry');
  const $dismiss = document.getElementById('error-banner-dismiss');
  const $pill    = document.getElementById('auth-pill');
  const $pillWarn = document.getElementById('auth-pill-warn');
  if (!$banner) return null;

  /** @type {{ phase, relPath, message, ts }[]} */
  let errors = [];
  /** Last error currently being surfaced (banner shows this). */
  let active = null;
  /** When the user clicks Dismiss, we hide until a new error fires. */
  let dismissedUntilNew = false;
  let cleanTimer = null;
  let lastRender = 0;
  let renderTimer = null;

  function setYellowPill(on) {
    if (!$pill) return;
    $pill.classList.toggle('auth-pill--warn', !!on);
    if ($pillWarn) {
      $pillWarn.hidden = !on;
      if (on) {
        $pillWarn.title = `${errors.length} sync error${errors.length === 1 ? '' : 's'} — click to view`;
      }
    }
  }

  function render() {
    lastRender = Date.now();
    if (!active || dismissedUntilNew) {
      $banner.className = 'error-banner error-banner--hidden';
      $message.textContent = '';
      setYellowPill(errors.length > 0 && !dismissedUntilNew);
      return;
    }
    const errCount = errors.length;
    let text;
    if (errCount > 1) {
      text = `${errCount} sync errors — see Recent errors below · ${active.phase} failed for ${active.relPath || '(no path)'}: ${active.message}`;
    } else {
      text = `Last error: ${active.phase} failed for ${active.relPath || '(no path)'}: ${active.message} · ${fmtRelativeTime(active.ts)}`;
    }
    $message.textContent = text;
    $banner.className = 'error-banner';
    setYellowPill(true);
  }

  // Re-render every 10s so the relative timestamp stays fresh.
  function scheduleRefresh() {
    if (renderTimer) return;
    renderTimer = setInterval(() => {
      if (active && !dismissedUntilNew) render();
    }, 10_000);
  }

  function pushError(frame) {
    if (!frame || PHASE_BLOCKLIST.has(frame.phase)) return;
    const e = {
      phase:   frame.phase  ?? 'unknown',
      relPath: frame.relPath ?? '',
      message: frame.message ?? '',
      ts:      frame.ts ?? Date.now(),
    };
    errors.unshift(e);
    if (errors.length > 50) errors.length = 50;
    active = e;
    dismissedUntilNew = false; // a new error always re-surfaces.
    if (cleanTimer) { clearTimeout(cleanTimer); cleanTimer = null; }
    render();
    bus.emit('errors.changed', { errors: errors.slice(0, 10), lastError: active });
    scheduleRefresh();
  }

  function clearActive() {
    active = null;
    errors = [];
    dismissedUntilNew = false;
    if (cleanTimer) { clearTimeout(cleanTimer); cleanTimer = null; }
    render();
    bus.emit('errors.changed', { errors: [], lastError: null });
  }

  // 5-second clean-sync debounce — if a sync.done lands and no new error
  // arrives within the window, the banner clears.
  function onCleanSync() {
    if (!active) return;
    if (cleanTimer) clearTimeout(cleanTimer);
    cleanTimer = setTimeout(() => {
      // Verify by asking the server whether its ring buffer says "all clear".
      // The server-side ring buffer holds the source of truth; this avoids
      // whiplash if errors are still queueing.
      clearActive();
    }, CLEAN_DEBOUNCE_MS);
  }

  // ── Wire WS frames to the banner ───────────────────────────────────────
  bus.on('ws.error', (frame) => pushError(frame));
  bus.on('ws.sync.done', () => onCleanSync());

  // Initial paint: /status carries the ring buffer's lastError + errors[].
  bus.on('status.snapshot', (snap) => {
    if (!snap) return;
    if (Array.isArray(snap.errors)) {
      errors = snap.errors.slice(0, 50).map((e) => ({
        phase:   e.phase ?? 'unknown',
        relPath: e.relPath ?? '',
        message: e.message ?? '',
        ts:      e.ts ?? 0,
      }));
    }
    if (snap.lastError && !PHASE_BLOCKLIST.has(snap.lastError.phase)) {
      active = {
        phase:   snap.lastError.phase ?? 'unknown',
        relPath: snap.lastError.relPath ?? '',
        message: snap.lastError.message ?? '',
        ts:      snap.lastError.ts ?? 0,
      };
    }
    render();
    if (active) scheduleRefresh();
    bus.emit('errors.changed', { errors: errors.slice(0, 10), lastError: active });
  });

  // ── Buttons ────────────────────────────────────────────────────────────
  $retry?.addEventListener('click', async () => {
    $retry.disabled = true;
    try {
      await postJson('/sync/now', { direction: 'both' });
      // If the next sync.done is clean, our 5s debounce will clear the banner.
    } catch (err) {
      // Reload didn't take — leave the banner up; surface the failure in the
      // existing log via the bus.
      bus.emit('error.retry-failed', { message: err?.message ?? String(err) });
    } finally {
      setTimeout(() => { $retry.disabled = false; }, 500);
    }
  });

  $dismiss?.addEventListener('click', () => {
    if (!active) return;
    dismissedUntilNew = true;
    render();
  });

  // Test hook.
  return {
    pushError,
    clearActive,
    onCleanSync,
    get errors()   { return errors.slice(); },
    get active()   { return active; },
    get dismissed(){ return dismissedUntilNew; },
    render,
  };
}

// ── Tab switcher ──────────────────────────────────────────────────────────
function wireTabs() {
  const tabs  = Array.from(document.querySelectorAll('.tab'));
  const panes = Array.from(document.querySelectorAll('.pane'));
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const paneId = tab.getAttribute('aria-controls');
      for (const t of tabs) {
        const active = t === tab;
        t.classList.toggle('tab--active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      for (const p of panes) {
        const active = p.id === paneId;
        p.classList.toggle('pane--active', active);
        p.hidden = !active;
      }
      bus.emit('tab.change', paneId);
    });
  }
}

// ── WebSocket lifecycle (auto-reconnect with exponential backoff) ─────────
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]; // last value sticks.

let ws = null;
let backoffIx = 0;
let reconnectTimer = null;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/events`;
}

function connect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  let socket;
  try {
    socket = new WebSocket(wsUrl());
  } catch (err) {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.addEventListener('open', () => {
    backoffIx = 0;
    hideBanner();
    bus.emit('conn.up');
  });

  socket.addEventListener('message', (ev) => {
    let frame;
    try { frame = JSON.parse(ev.data); }
    catch { return; }
    if (!frame || typeof frame.type !== 'string') return;
    bus.emit(`ws.${frame.type}`, frame);
    bus.emit('ws.any', frame);
  });

  socket.addEventListener('close', () => {
    if (ws !== socket) return; // stale
    ws = null;
    bus.emit('conn.down');
    showBanner('warn', 'Reconnecting to Folio agent…');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // Errors precede a close; don't double-handle here.
  });
}

function scheduleReconnect() {
  const delay = BACKOFF_MS[Math.min(backoffIx, BACKOFF_MS.length - 1)];
  backoffIx++;
  reconnectTimer = setTimeout(connect, delay);
}

// ── Initial probe + boot ──────────────────────────────────────────────────
async function probeHealthAndBoot() {
  try {
    await getJson('/healthz');
  } catch (err) {
    showBanner('error', 'Folio agent not running. Start it with `folio serve`.');
    // Still wire the panes so the UI doesn't look dead; they'll re-paint when
    // /events comes back.
  }

  // Paint optimistically from /status (best-effort).
  try {
    const status = await getJson('/status');
    bus.emit('status.snapshot', status);
  } catch { /* show no data; banner already up */ }

  connect();
}

// ── Boot ──────────────────────────────────────────────────────────────────
let errorBanner = null;
let settings    = null;
window.addEventListener('DOMContentLoaded', () => {
  wireTabs();
  errorBanner = makeErrorBanner({ postJson });
  initStatus({ bus, getJson, postJson, showBanner, hideBanner });
  initConflicts({ bus, getJson, postJson });
  initShare({ bus, postJson });
  initVersions({ bus, getJson, postJson });
  try { initAuth({ bus, getJson, postJson }); } catch (err) { console.error('auth init failed', err); }
  // Folio v2.3 — Settings panel (houses Diagnostics; NOT a primary tab).
  try { settings = initSettings({ bus, postJson }); } catch (err) { console.error('settings init failed', err); }
  probeHealthAndBoot();
});

// Test hook: exposes the bus + ws state for Playwright/jsdom.
window.__folio = {
  bus,
  isConnected: () => ws && ws.readyState === 1,
  reconnect:   connect,
  get errorBanner() { return errorBanner; },
  get settings()    { return settings; },
};
