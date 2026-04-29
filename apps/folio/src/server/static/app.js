/**
 * app.js — Folio.B1.ui main controller.
 *
 * Wires the tab switcher, the WebSocket connection (with exponential
 * backoff), and the connection banner.  Routes WS frames to per-pane
 * modules via a shared event bus.
 *
 * Modules import this file purely for the bus + helpers; they don't form
 * a hard dependency graph (which would require a build step).
 */

import { initStatus }    from '/status.js';
import { initConflicts } from '/conflicts.js';
import { initShare }     from '/share.js';
import { initAuth }      from '/auth.js';
import { initVersions }  from '/versions.js';

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
window.addEventListener('DOMContentLoaded', () => {
  wireTabs();
  initStatus({ bus, getJson, postJson, showBanner, hideBanner });
  initConflicts({ bus, getJson, postJson });
  initShare({ bus, postJson });
  initVersions({ bus, getJson, postJson });
  try { initAuth({ bus, getJson, postJson }); } catch (err) { console.error('auth init failed', err); }
  probeHealthAndBoot();
});

// Test hook: exposes the bus + ws state for Playwright/jsdom.
window.__folio = {
  bus,
  isConnected: () => ws && ws.readyState === 1,
  reconnect:   connect,
};
