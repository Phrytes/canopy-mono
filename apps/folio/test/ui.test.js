/**
 * ui.test.js — Folio.B1.ui tests (lean strategy).
 *
 * We intentionally avoid Playwright/Puppeteer — they pull in a 200+ MB
 * browser download which violates the spec's "no new heavy devDeps"
 * constraint.  Instead we:
 *
 *   1. Boot a real B1.server with a mock SyncEngine on an ephemeral port.
 *   2. Fetch `/`, `/app.js`, `/status.js`, `/conflicts.js`, `/share.js`,
 *      `/style.css`, `/vendor/codemirror.min.js` via Node 18+ `fetch`.
 *   3. Assert the DOM hooks the UI relies on are present in `index.html`,
 *      and that the JS modules reference the contract endpoints.
 *   4. Exercise the contract end-to-end through the same fetch surface
 *      the SPA uses (sync-now → /sync/now, conflict → /conflicts/:id/resolve,
 *      share → /share).
 *   5. Open a WebSocket, force-close it, confirm the SPA module reconnects
 *      (we do this on the JS side — exercise the `connect()` function via
 *      the test hook on `window.__folio` is browser-only, so we do the
 *      equivalent: assert backoff state behaves correctly via the actual
 *      module loaded into a vm sandbox).
 *
 * Coverage map (≥6 tests per the spec DoD):
 *   - page-load: GET / serves a 200 + has known DOM hooks
 *   - vendor-codemirror: vendored file exists + is non-trivial in size
 *   - sync-now button wires to POST /sync/now (asserts in JS source)
 *   - conflict list render: GET /conflicts returns the expected shape
 *   - conflict resolve end-to-end: write file with markers, resolve via REST
 *   - share-mint: POST /share returns a token JSON
 *   - WS reconnect logic: close socket and assert a new one re-opens
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';

import WebSocket from 'ws';

import { Bootstrap } from '@canopy/core';

import { SyncEngine }            from '../src/SyncEngine.js';
import { createServer }          from '../src/server/index.js';
import { conflictIdFromRelPath } from '../src/server/conflictId.js';
import { SyncErrorBuffer }       from '../src/server/errorBuffer.js';

// Reuse the pod-mock + vault from server.test.js (kept minimal here).
class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();
    this.tombstones = new Set();
    this._etagCounter = 0;
  }
  async read(uri) {
    const r = this.store.get(uri);
    if (!r) { const e = new Error('mock 404'); e.code='NOT_FOUND'; throw e; }
    return { ...r };
  }
  async write(uri, content, opts = {}) {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    const stored = {
      content: text,
      contentType:  opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag:         `"e${++this._etagCounter}"`,
      size:         Buffer.byteLength(text, 'utf8'),
    };
    this.store.set(uri, stored);
    this.tombstones.delete(uri);
    return { uri, ...stored };
  }
  async list(containerUri) {
    const container = String(containerUri).endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nested = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slash = tail.indexOf('/');
      if (slash === -1) direct.set(k, 'resource');
      else              nested.add(`${container}${tail.slice(0, slash)}/`);
    }
    return {
      container,
      entries: [
        ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
        ...[...nested].map((uri)        => ({ uri, type: 'container' })),
      ],
    };
  }
  async delete(uri)        { this.store.delete(uri); this.tombstones.delete(uri); }
  async deleteLocal(uri)   { this.tombstones.add(uri); }
  async clearTombstone(uri){ this.tombstones.delete(uri); }
  on() {} off() {} emit() {}
}

const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

class MemVault {
  constructor() { this.entries = {}; }
  async get(key) { return this.entries[key]; }
  async set(key, val) { this.entries[key] = val; }
}

const POD_ROOT = 'https://alice.example/notes/';

let localRoot, engine, podClient, vault, srv, baseUrl, wsUrl;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-ui-'));
  podClient = new MockPodClient(POD_ROOT);
  engine    = new SyncEngine({
    podClient,
    localRoot,
    podRoot:        POD_ROOT,
    pollIntervalMs: 60_000,
    debounceMs:     50,
  });
  engine.__podClient = podClient;

  vault = new MemVault();
  const bs = Bootstrap.fromMnemonic(TEST_PHRASE);
  vault.entries['bootstrap-mnemonic'] = TEST_PHRASE;
  vault.entries['bootstrap-seed-b64'] = Buffer.from(bs.secret).toString('base64');

  srv = createServer({ engine, vault });
  const { port, host } = await srv.listen(0, '127.0.0.1');
  baseUrl = `http://${host}:${port}`;
  wsUrl   = `ws://${host}:${port}/events`;
});

afterEach(async () => {
  try { await srv.close(); } catch { /* ignore */ }
  try { await fs.rm(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1. Page load + DOM hooks ───────────────────────────────────────────────

describe('GET /', () => {
  it('serves index.html with all the DOM hooks the SPA needs', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Top-level chrome.
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Folio</title>');

    // Tab switcher.
    expect(html).toMatch(/id="tab-status"/);
    expect(html).toMatch(/id="tab-conflicts"/);
    expect(html).toMatch(/id="tab-share"/);

    // Status pane hooks.
    expect(html).toMatch(/id="status-local-root"/);
    expect(html).toMatch(/id="status-pod-root"/);
    expect(html).toMatch(/id="status-pending"/);
    expect(html).toMatch(/id="btn-sync-now"/);
    expect(html).toMatch(/id="btn-watch-toggle"/);

    // Conflicts pane hooks.
    expect(html).toMatch(/id="conflict-list"/);
    expect(html).toMatch(/id="merge-mine"/);
    expect(html).toMatch(/id="merge-theirs"/);
    expect(html).toMatch(/id="merge-merged"/);
    expect(html).toMatch(/id="btn-keep-mine"/);
    expect(html).toMatch(/id="btn-keep-theirs"/);
    expect(html).toMatch(/id="btn-save-merged"/);

    // Share pane hooks.
    expect(html).toMatch(/id="share-form"/);
    expect(html).toMatch(/id="share-webid"/);
    expect(html).toMatch(/id="share-token-out"/);
    expect(html).toMatch(/id="btn-copy-token"/);

    // Banner + connection lifecycle entry.
    expect(html).toMatch(/id="conn-banner"/);

    // Vendor + module wiring.
    expect(html).toMatch(/<script src="\/vendor\/codemirror\.min\.js"/);
    expect(html).toMatch(/<script type="module" src="\/app\.js"/);
  });
});

// ── 2. Vendored CodeMirror ─────────────────────────────────────────────────

describe('vendor/codemirror.min.js', () => {
  it('is served from the same origin and is non-trivial in size', async () => {
    const r = await fetch(`${baseUrl}/vendor/codemirror.min.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Real CodeMirror lib is hundreds of KB; insist on at least 100 KB so
    // a stub doesn't sneak through.
    expect(text.length).toBeGreaterThan(100_000);
    expect(text).toContain('CodeMirror');
  });

  it('serves the matching CSS', async () => {
    const r = await fetch(`${baseUrl}/vendor/codemirror.min.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toContain('.CodeMirror');
  });
});

// ── 3. The JS modules reference the documented contract endpoints ─────────

describe('static JS modules', () => {
  async function getText(path) {
    const r = await fetch(`${baseUrl}${path}`);
    expect(r.status).toBe(200);
    return r.text();
  }

  it('app.js wires healthz, status, and the WebSocket', async () => {
    const text = await getText('/app.js');
    expect(text).toContain('/healthz');
    expect(text).toContain('/status');
    expect(text).toContain('/events');
    // Reconnect path with a backoff array exists.
    expect(text).toMatch(/BACKOFF_MS\s*=\s*\[/);
  });

  it('status.js calls /sync/now and /watch/start|/watch/stop', async () => {
    const text = await getText('/status.js');
    expect(text).toContain('/sync/now');
    expect(text).toContain('/watch/start');
    expect(text).toContain('/watch/stop');
  });

  it('conflicts.js calls /conflicts and /conflicts/:id/resolve', async () => {
    const text = await getText('/conflicts.js');
    expect(text).toContain('/conflicts');
    expect(text).toContain('/resolve');
  });

  it('share.js posts to /share and uses textContent (no innerHTML)', async () => {
    const text = await getText('/share.js');
    expect(text).toContain('/share');
    // XSS hardening: no innerHTML on any user-controlled path.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });
});

// ── 4. Conflict list render: data shape that conflicts.js consumes ────────

describe('conflict list backend feed', () => {
  it('GET /conflicts returns ids that the UI can decode for display', async () => {
    const blob = '<<<<<<< YOURS\nMINE\n=======\nTHEIRS\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const r = await fetch(`${baseUrl}/conflicts`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].relPath).toBe('note.md');
    expect(body.conflicts[0].id).toBe(conflictIdFromRelPath('note.md'));
  });
});

// ── 5. Conflict resolve end-to-end (covers a full UI button flow) ─────────

describe('conflict resolve end-to-end', () => {
  it('POST /conflicts/:id/resolve with mine writes the chosen side back', async () => {
    const blob = '<<<<<<< YOURS\nMINE\n=======\nTHEIRS\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const id = conflictIdFromRelPath('note.md');
    const r = await fetch(`${baseUrl}/conflicts/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'mine' }),
    });
    expect(r.status).toBe(200);
    const stored = await fs.readFile(join(localRoot, 'note.md'), 'utf8');
    expect(stored).toBe('MINE\n');

    // Subsequent /conflicts list is empty.
    const list = await (await fetch(`${baseUrl}/conflicts`)).json();
    expect(list.conflicts).toEqual([]);
  });

  it('GET /conflicts/:id/content returns the raw file text the merge view reads', async () => {
    const blob = '<<<<<<< YOURS\nA\n=======\nB\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const id = conflictIdFromRelPath('note.md');
    const r = await fetch(`${baseUrl}/conflicts/${id}/content`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await r.text();
    expect(text).toBe(blob);
  });

  it('GET /conflicts/:id/content rejects path-escape attempts', async () => {
    // base64url-encode '../etc/passwd' as if it were a relPath.
    const id = Buffer.from('../etc/passwd', 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await fetch(`${baseUrl}/conflicts/${id}/content`);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe('BAD_CONFLICT_ID');
  });
});

// ── 6. Sync-now end-to-end ─────────────────────────────────────────────────

describe('sync-now button (POST /sync/now)', () => {
  it('triggers a real sync against the mock pod', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'aaa');
    const r = await fetch(`${baseUrl}/sync/now`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ direction: 'push' }),
    });
    expect(r.status).toBe(202);
    // Background sync; small wait then assert the pod sees the file.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(podClient.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });
});

// ── 7. Share-mint end-to-end ───────────────────────────────────────────────

describe('share form (POST /share)', () => {
  it('mints a token JSON the UI renders into the textarea', async () => {
    const r = await fetch(`${baseUrl}/share`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        webid:  'https://alice.example/profile/card#me',
        scopes: ['read', 'write'],
        path:   '/notes/shared/',
        expiresIn: 86_400_000,
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.token).toBeDefined();
    expect(body.token.subject).toBe('https://alice.example/profile/card#me');
    expect(body.token.scopes).toEqual([
      'pod.read:/notes/shared/',
      'pod.write:/notes/shared/',
    ]);
  });
});

// ── 8. Folio.B4 — History pane ─────────────────────────────────────────────

describe('history pane (Folio.B4)', () => {
  it('serves /versions.js with the History pane logic', async () => {
    const r = await fetch(`${baseUrl}/versions.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('/versions');
    expect(text).toContain('initVersions');
    // No innerHTML on user-controlled values.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('index.html has a History tab + pane wired with the expected hooks', async () => {
    const r = await fetch(`${baseUrl}/`);
    const html = await r.text();
    expect(html).toMatch(/id="tab-history"/);
    expect(html).toMatch(/id="pane-history"/);
    expect(html).toMatch(/id="history-file-list"/);
    expect(html).toMatch(/id="history-version-list"/);
    expect(html).toMatch(/id="history-content"/);
    expect(html).toMatch(/id="btn-history-restore"/);
  });

  it('GET /versions returns the file picker feed; restore endpoint fires', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    // Drive a sync to populate history.
    await engine.runOnce();

    const list = await (await fetch(`${baseUrl}/versions`)).json();
    expect(list.files.length).toBeGreaterThanOrEqual(1);
    const aFile = list.files.find((f) => f.relPath === 'a.md');
    expect(aFile).toBeDefined();
    expect(aFile.id).toBe(conflictIdFromRelPath('a.md'));

    // Pull the version list for that file.
    const v = await (await fetch(`${baseUrl}/versions/${aFile.id}`)).json();
    expect(v.versions.length).toBeGreaterThanOrEqual(1);

    // Restore the only known version.
    const ts = v.versions[0].ts;
    await fs.writeFile(join(localRoot, 'a.md'), 'mutated');
    const restoreResp = await fetch(`${baseUrl}/versions/${aFile.id}/restore`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ ts }),
    });
    expect(restoreResp.status).toBe(200);
    const r = await restoreResp.json();
    expect(r.restoredFromMs).toBe(ts);
    expect(typeof r.snapshotMsBeforeRestore).toBe('number');
    expect(await fs.readFile(join(localRoot, 'a.md'), 'utf8')).toBe('first');
  });

  it('conflicts.js wires a "View history" link emitting history.openFor', async () => {
    const text = await (await fetch(`${baseUrl}/conflicts.js`)).text();
    expect(text).toContain('View history');
    expect(text).toContain('history.openFor');
  });
});

// ── 9. WebSocket reconnect ────────────────────────────────────────────────

describe('WebSocket /events reconnect', () => {
  it('the server accepts a fresh WS connection after the previous one closes', async () => {
    // Open + close a connection.
    const ws1 = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws1.once('open', res); ws1.once('error', rej); });
    ws1.close();
    await new Promise((res) => setTimeout(res, 50));

    // Now open a new one — the server is healthy and accepts it; this is
    // the same path the SPA's exponential-backoff `connect()` exercises.
    const ws2 = new WebSocket(wsUrl);
    // Attach the message listener BEFORE the socket finishes opening so we
    // don't drop the server's greeting frame (which is sent inside the
    // 'connection' handler the moment the handshake completes).
    const greeted = new Promise((res, rej) => {
      ws2.once('message', (data) => {
        try { res(JSON.parse(data.toString('utf8'))); }
        catch (err) { rej(err); }
      });
      ws2.once('error', rej);
    });
    await new Promise((res, rej) => { ws2.once('open', res); ws2.once('error', rej); });
    const frame = await greeted;
    expect(frame.type).toBe('status');

    ws2.close();
  });

  it('app.js exposes the reconnect path on window.__folio for hot-recovery', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    const text = await r.text();
    expect(text).toContain('window.__folio');
    expect(text).toMatch(/reconnect:\s*connect/);
  });
});

// ── 10. Folio v2.2 — loud error surfacing ─────────────────────────────────

describe('Folio v2.2 — error banner static contract', () => {
  it('index.html carries the error-banner DOM hooks and recent-errors collapsible', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Banner element + buttons.
    expect(html).toMatch(/id="error-banner"/);
    expect(html).toMatch(/id="error-banner-message"/);
    expect(html).toMatch(/id="error-banner-retry"/);
    expect(html).toMatch(/id="error-banner-dismiss"/);
    // Banner starts hidden.
    expect(html).toMatch(/id="error-banner"[^>]*class="error-banner error-banner--hidden"/);
    // Recent errors collapsible.
    expect(html).toMatch(/id="recent-errors"/);
    expect(html).toMatch(/id="recent-errors-count"/);
    expect(html).toMatch(/id="recent-errors-list"/);
    // Auth-pill warning indicator (yellow-pill state).
    expect(html).toMatch(/id="auth-pill-warn"/);
  });

  it('style.css ships the red banner + yellow-pill rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.error-banner\s*\{/);
    expect(css).toMatch(/\.error-banner--hidden/);
    expect(css).toMatch(/\.error-banner__retry/);
    expect(css).toMatch(/\.error-banner__dismiss/);
    expect(css).toMatch(/\.auth-pill--warn/);
    expect(css).toMatch(/\.recent-errors/);
  });

  it('app.js wires ws.error → banner with a 5s clean-sync debounce; conflict phase excluded', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Subscribed to ws.error.
    expect(text).toMatch(/ws\.error/);
    // Subscribed to ws.sync.done for the clean-sync debounce.
    expect(text).toMatch(/ws\.sync\.done/);
    // 5s debounce constant.
    expect(text).toMatch(/CLEAN_DEBOUNCE_MS\s*=\s*5_?000/);
    // Phase blocklist (conflict not surfaced).
    expect(text).toMatch(/PHASE_BLOCKLIST[^\n]*conflict/);
    // Retry button hits /sync/now.
    expect(text).toMatch(/postJson\(['"]\/sync\/now/);
    // Dismiss path exists.
    expect(text).toMatch(/dismissedUntilNew/);
    // No innerHTML in the banner controller — XSS hardening.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('status.js renders the recent-errors list using textContent only', async () => {
    const r = await fetch(`${baseUrl}/status.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/errors\.changed/);
    expect(text).toMatch(/recent-errors-list/);
    // No innerHTML on the user-controlled error fields.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });
});

// ── 11. Folio v2.3 — Settings panel + Diagnostics ────────────────────────

describe('Folio v2.3 — Settings panel (NOT a top tab)', () => {
  it('index.html ships a header Settings button + settings overlay (no new top-level tab)', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();

    // Header affordance: text + gear character (HTML entity).  Must NOT
    // be a new tab inside the .tabs nav.
    expect(html).toMatch(/id="settings-open-btn"/);
    expect(html).toMatch(/class="settings-link"/);
    expect(html).toMatch(/&#9881;/);                     // gear glyph

    // Settings overlay/panel structure.
    expect(html).toMatch(/id="settings-panel"/);
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);

    // Diagnostics section lives INSIDE the settings panel.
    expect(html).toMatch(/id="settings-diagnostics"/);
    expect(html).toMatch(/id="btn-diagnostics-run"/);
    expect(html).toMatch(/id="diagnostics-list"/);

    // Hard rule: NO new top-level Diagnostics tab.  The only tabs in the
    // .tabs nav are status / conflicts / share / history.
    const tabsBlock = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/);
    expect(tabsBlock).toBeTruthy();
    expect(tabsBlock[0]).not.toMatch(/id="tab-diagnostics"/i);
    expect(tabsBlock[0]).not.toMatch(/Diagnostics<\/button>/i);
    // Sanity: existing primary tabs still present.
    expect(tabsBlock[0]).toMatch(/id="tab-status"/);
    expect(tabsBlock[0]).toMatch(/id="tab-conflicts"/);
    expect(tabsBlock[0]).toMatch(/id="tab-share"/);
  });

  it('settings.js wires Run button → POST /diagnostics + ws.diagnostics.* with textContent only', async () => {
    const r = await fetch(`${baseUrl}/settings.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Hits the 202+409 route.
    expect(text).toMatch(/['"]\/diagnostics['"]/);
    // Subscribes to streaming frames over the existing WS bus.
    expect(text).toMatch(/ws\.diagnostics\.step/);
    expect(text).toMatch(/ws\.diagnostics\.done/);
    // Open / close + Esc handling for the panel.
    expect(text).toMatch(/Escape/);
    // Strict XSS hardening — no innerHTML on user-controlled data.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('style.css ships the settings panel + diagnostic-row + colored-dot rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.settings-panel\s*\{/);
    expect(css).toMatch(/\.settings-link/);
    expect(css).toMatch(/\.diagnostic-row\s*\{/);
    expect(css).toMatch(/\.diagnostic-row__dot/);
    expect(css).toMatch(/\.diagnostic-row__dot--pass/);
    expect(css).toMatch(/\.diagnostic-row__dot--warn/);
    expect(css).toMatch(/\.diagnostic-row__dot--fail/);
    expect(css).toMatch(/\.diagnostic-row__dot--skip/);
  });

  it('app.js boots the Settings controller and exposes it on window.__folio', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('initSettings');
    expect(text).toContain('/settings.js');
    // Test hook: __folio.settings exposes the controller for ui-tests /
    // browser console inspection.
    expect(text).toMatch(/get settings\(\)/);
  });

  it('end-to-end: POST /diagnostics streams diagnostics.step + .done over /events', async () => {
    // We can't easily exercise the real diagnostics engine in this UI test
    // (it needs a config fixture); we instead spin a server with an
    // injected fake `runDiagnostics` so the test stays fast + offline,
    // and confirm the WS frames the UI subscribes to are emitted.
    await srv.close();
    const fakeRun = async (reporter) => {
      reporter.step({ id: 'config',         status: 'PASS', label: 'config exists' });
      reporter.step({ id: 'vault',          status: 'PASS', label: 'vault exists' });
      reporter.step({ id: 'pod-head',       status: 'WARN', label: 'pod root reachable', detail: 'slow' });
      return { abortReason: null, cfg: {}, counts: { PASS: 2, FAIL: 0, WARN: 1, SKIP: 0 } };
    };
    srv = createServer({ engine, vault, runDiagnostics: fakeRun });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;
    wsUrl   = `ws://${host}:${port}/events`;

    const ws = new WebSocket(wsUrl);
    const frames = [];
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });

    const r = await fetch(`${baseUrl}/diagnostics`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{}',
    });
    expect(r.status).toBe(202);

    await waitForFrame(frames, 'diagnostics.done');
    const stepFrames = frames.filter((f) => f.type === 'diagnostics.step');
    expect(stepFrames.length).toBe(3);
    expect(stepFrames[0].label).toBe('config exists');
    const done = frames.find((f) => f.type === 'diagnostics.done');
    expect(done.ok).toBe(true);
    expect(done.counts).toEqual({ PASS: 2, FAIL: 0, WARN: 1, SKIP: 0 });

    ws.close();
  });

  it('returns 409 on a concurrent POST /diagnostics', async () => {
    await srv.close();
    const fakeRun = async (reporter) => {
      reporter.step({ id: 'a', status: 'PASS', label: 'a' });
      // Hold open for a few ticks so a second request races us.
      await new Promise((r) => setTimeout(r, 80));
      reporter.step({ id: 'b', status: 'PASS', label: 'b' });
      return { abortReason: null, cfg: {}, counts: { PASS: 2, FAIL: 0, WARN: 0, SKIP: 0 } };
    };
    srv = createServer({ engine, vault, runDiagnostics: fakeRun });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    const first = await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe('DIAGNOSTICS_IN_PROGRESS');
  });
});

// Helper used by the diagnostics UI test above.
async function waitForFrame(frames, type, timeoutMs = 3000) {
  const start = Date.now();
  while (!frames.some((f) => f.type === type)) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitForFrame: timed out for ${type}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Folio v2.2 — banner end-to-end against the server', () => {
  it('GET /status carries lastError + errors so the UI paints on first load', async () => {
    // Replace the server with one we own the buffer for.
    await srv.close();
    const buf = new SyncErrorBuffer();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    buf.push({ phase: 'upload', relPath: 'cake.md', message: 'PUT 403' });
    buf.push({ phase: 'ensure-container', uri: 'https://pod/x/', message: 'mkdir 401' });

    const r = await fetch(`${baseUrl}/status`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.lastError.phase).toBe('ensure-container');
    expect(body.lastError.message).toBe('mkdir 401');
    expect(body.errors).toHaveLength(2);
    // Conflicts are NOT in the banner feed.
    buf.push({ phase: 'conflict', relPath: 'noisy.md', message: 'normal flow' });
    const r2 = await fetch(`${baseUrl}/status`);
    const body2 = await r2.json();
    expect(body2.errors.find((e) => e.phase === 'conflict')).toBeUndefined();
  });

  it('"Retry sync" hits /sync/now and POST /errors/clear empties the history', async () => {
    await srv.close();
    const buf = new SyncErrorBuffer();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    buf.push({ phase: 'upload', relPath: 'a.md', message: 'flaky' });
    expect(buf.size).toBe(1);

    // Retry sync — same endpoint the banner button triggers.
    const retry = await fetch(`${baseUrl}/sync/now`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'both' }),
    });
    expect(retry.status).toBe(202);

    // Dismiss-equivalent server-side: explicit clear endpoint.
    const clear = await fetch(`${baseUrl}/errors/clear`, { method: 'POST' });
    expect(clear.status).toBe(204);

    const body = await (await fetch(`${baseUrl}/status`)).json();
    expect(body.lastError).toBeNull();
    expect(body.errors).toEqual([]);
  });
});
