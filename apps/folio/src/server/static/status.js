/**
 * status.js — Status pane.
 *
 * Subscribes to:
 *   - status.snapshot          (initial paint from GET /status)
 *   - ws.status                (WS frame; partial — stats + watching)
 *   - ws.sync.progress         (transient; renders in log)
 *   - ws.sync.done             (re-fetch /status to refresh pending counts;
 *                               also seeds the recently-synced files list)
 *   - ws.sync.force.start      (Folio v2.5 — log entry)
 *   - ws.sync.force.done       (Folio v2.5 — log entry; refresh status)
 *   - ws.error                 (renders in log)
 *
 * Buttons:
 *   - #btn-sync-now      → POST /sync/now {direction:'both'}
 *   - #btn-watch-toggle  → POST /watch/start | /watch/stop
 *   - #btn-force-push    → opens the force-confirm-modal; on Continue,
 *                          POST /sync/force (Folio v2.5)
 *   - #btn-verify-all    → for each row in the recently-synced list,
 *                          GET /verify/<id> (Folio v2.5)
 */

export function initStatus({ bus, getJson, postJson, showBanner, hideBanner }) {
  const $localRoot     = document.getElementById('status-local-root');
  const $podRoot       = document.getElementById('status-pod-root');
  const $lastSync      = document.getElementById('status-last-sync');
  const $watching      = document.getElementById('status-watching');
  const $pending       = document.getElementById('status-pending');
  const $openConflicts = document.getElementById('status-open-conflicts');
  const $log           = document.getElementById('status-log');
  const $btnSync       = document.getElementById('btn-sync-now');
  const $btnWatch      = document.getElementById('btn-watch-toggle');

  // Folio v2.2 — recent-errors collapsible.
  const $recentErrors      = document.getElementById('recent-errors');
  const $recentErrorsCount = document.getElementById('recent-errors-count');
  const $recentErrorsList  = document.getElementById('recent-errors-list');

  // Folio v2.5 — Force re-push button + confirm modal + verify list.
  const $btnForcePush      = document.getElementById('btn-force-push');
  const $forceModal        = document.getElementById('force-confirm-modal');
  const $btnForceConfirm   = document.getElementById('btn-force-confirm');
  const $btnForceCancel    = document.getElementById('btn-force-cancel');
  const $verifyList        = document.getElementById('verify-list');
  const $verifyListCount   = document.getElementById('verify-list-count');
  const $verifyListItems   = document.getElementById('verify-list-items');
  const $btnVerifyAll      = document.getElementById('btn-verify-all');

  // Map relPath → { state, sizeMatches, shaMatches }, last 10 only.
  // state: 'gray' (not yet) | 'green' | 'yellow' | 'red'.
  const verifyState = new Map();

  let watchingState = false;

  function setText(el, value) {
    // Always textContent — no innerHTML (XSS hardening).
    el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function fmtTs(ms) {
    if (!ms || typeof ms !== 'number') return '—';
    return new Date(ms).toLocaleString();
  }

  function fmtPending(p) {
    if (!p) return '—';
    return `${p.uploads} up · ${p.downloads} down · ${p.deletes} del · ${p.conflicts} conf`;
  }

  function setWatching(flag) {
    watchingState = !!flag;
    $watching.textContent = watchingState ? 'yes' : 'no';
    $btnWatch.textContent = watchingState ? 'Stop watch' : 'Start watch';
  }

  function paint(snap) {
    if (!snap) return;
    setText($localRoot, snap.localRoot);
    setText($podRoot,   snap.podRoot);
    setText($lastSync,  fmtTs(snap.lastSyncAt));
    setText($pending,   fmtPending(snap.pending));
    setText($openConflicts, snap.openConflictFiles ?? 0);
    setWatching(snap.watching);
    if (snap.scanError) {
      logEntry(`scan error: ${snap.scanError}`, true);
    }
  }

  function logEntry(msg, isErr = false) {
    const div = document.createElement('div');
    div.className = `log-entry${isErr ? ' log-entry--err' : ''}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    $log.appendChild(div);
    // Keep only the last 50 entries.
    while ($log.childNodes.length > 50) $log.removeChild($log.firstChild);
    $log.scrollTop = $log.scrollHeight;
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  bus.on('status.snapshot', paint);

  bus.on('ws.status', (frame) => {
    if (typeof frame.watching === 'boolean') setWatching(frame.watching);
  });

  bus.on('ws.sync.progress', (frame) => {
    logEntry(`sync ${frame.direction || ''} → ${frame.phase}${frame.relPath ? ' ('+frame.relPath+')' : ''}`);
  });

  bus.on('ws.sync.done', async (frame) => {
    logEntry(`sync done — ${frame.uploads} up, ${frame.downloads} down, ${frame.deletes} del, ${frame.conflicts} conf`);
    // Re-fetch the canonical /status to refresh pending counts + lastSyncAt.
    try {
      const fresh = await getJson('/status');
      paint(fresh);
    } catch { /* will repaint on next /status call */ }
  });

  // Folio v2.5 — force-push lifecycle.
  bus.on('ws.sync.force.start', () => {
    logEntry('force re-push started…');
  });
  bus.on('ws.sync.force.done', async (frame) => {
    logEntry(`force re-push done — ${frame.uploads} up, ${frame.errors} err`,
             frame.errors > 0);
    if ($btnForcePush) $btnForcePush.disabled = false;
    try {
      const fresh = await getJson('/status');
      paint(fresh);
    } catch { /* ignore */ }
  });

  bus.on('ws.error', (frame) => {
    logEntry(`error in ${frame.phase}${frame.relPath ? ' ('+frame.relPath+')' : ''}: ${frame.message}`, true);
  });

  // Folio v2.2 — paint the recent-errors collapsible whenever the central
  // error tracker (in app.js) updates its view.  Last-error-first.  All text
  // is set via textContent so any user-controlled relPath/message can't XSS.
  bus.on('errors.changed', ({ errors }) => {
    if (!$recentErrors) return;
    const list = Array.isArray(errors) ? errors : [];
    const display = list.slice(0, 10);
    $recentErrors.hidden = display.length === 0;
    if ($recentErrorsCount) $recentErrorsCount.textContent = String(list.length);
    if (!$recentErrorsList) return;
    while ($recentErrorsList.firstChild) {
      $recentErrorsList.removeChild($recentErrorsList.firstChild);
    }
    for (const e of display) {
      const li = document.createElement('li');

      const phase = document.createElement('span');
      phase.className   = 'recent-errors__phase';
      phase.textContent = String(e.phase ?? 'unknown');

      const path = document.createElement('span');
      path.className   = 'recent-errors__path';
      path.textContent = String(e.relPath ?? '');
      // Tooltip carries the raw message — textContent on a title attribute
      // assignment is automatic since `title=` is a string property.
      path.title = String(e.message ?? '');

      const ts = document.createElement('span');
      ts.className   = 'recent-errors__ts';
      ts.textContent = e.ts ? new Date(e.ts).toLocaleTimeString() : '';

      li.appendChild(phase);
      li.appendChild(path);
      li.appendChild(ts);
      $recentErrorsList.appendChild(li);
    }
  });

  bus.on('conn.up', () => { hideBanner(); });

  // ── Buttons ─────────────────────────────────────────────────────────────
  $btnSync.addEventListener('click', async () => {
    $btnSync.disabled = true;
    logEntry('sync requested…');
    try {
      await postJson('/sync/now', { direction: 'both' });
      // Progress + done arrive over WS.
    } catch (err) {
      logEntry(`sync failed: ${err.message}`, true);
    } finally {
      // Re-enable shortly; sync is fire-and-forget at server level.
      setTimeout(() => { $btnSync.disabled = false; }, 500);
    }
  });

  $btnWatch.addEventListener('click', async () => {
    const target = watchingState ? '/watch/stop' : '/watch/start';
    $btnWatch.disabled = true;
    try {
      const r = await postJson(target, {});
      setWatching(r.watching);
      logEntry(`watch → ${r.watching ? 'on' : 'off'}`);
    } catch (err) {
      logEntry(`watch toggle failed: ${err.message}`, true);
    } finally {
      $btnWatch.disabled = false;
    }
  });

  // Refresh /status whenever the user re-opens the status tab.
  bus.on('tab.change', async (paneId) => {
    if (paneId !== 'pane-status') return;
    try {
      const fresh = await getJson('/status');
      paint(fresh);
    } catch { /* ignore */ }
  });

  // ── Folio v2.5 — Force re-push (button + confirm modal) ─────────────────
  function openForceModal() {
    if (!$forceModal) return;
    $forceModal.hidden = false;
  }
  function closeForceModal() {
    if (!$forceModal) return;
    $forceModal.hidden = true;
  }

  if ($btnForcePush && $forceModal) {
    $btnForcePush.addEventListener('click', () => {
      // Always gate behind the confirm — never fire on the click directly.
      openForceModal();
    });
  }
  if ($btnForceCancel) {
    $btnForceCancel.addEventListener('click', () => { closeForceModal(); });
  }
  if ($btnForceConfirm) {
    $btnForceConfirm.addEventListener('click', async () => {
      closeForceModal();
      if ($btnForcePush) $btnForcePush.disabled = true;
      logEntry('force re-push requested…');
      try {
        await postJson('/sync/force', {});
        // sync.force.start / sync.force.done arrive over WS.
      } catch (err) {
        logEntry(`force re-push failed: ${err.message}`, true);
        if ($btnForcePush) $btnForcePush.disabled = false;
      }
    });
  }

  // ── Folio v2.5 — Verify list ────────────────────────────────────────────
  // Encodes a relPath to the server-side base64url id.  Mirrors
  // server/conflictId.js exactly — same algorithm, in browser-safe form.
  function relPathToId(relPath) {
    // Use TextEncoder + btoa for unicode-safe base64.
    const bytes = new TextEncoder().encode(String(relPath ?? ''));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function classifyVerifyResult(r) {
    if (!r || r.exists === false) return 'red';
    // exists.  size + sha must both either be absent OR match.  Anything
    // explicitly false → yellow.
    const sizeOk = r.sizeMatches !== false;
    const shaOk  = r.shaMatches  !== false;
    if (sizeOk && shaOk) return 'green';
    return 'yellow';
  }

  function renderVerifyList() {
    if (!$verifyListItems) return;
    while ($verifyListItems.firstChild) {
      $verifyListItems.removeChild($verifyListItems.firstChild);
    }
    const entries = [...verifyState.entries()];
    if ($verifyListCount) $verifyListCount.textContent = String(entries.length);
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No files synced yet.';
      $verifyListItems.appendChild(empty);
      return;
    }
    for (const [relPath, info] of entries) {
      const li = document.createElement('li');
      li.dataset.relpath = relPath;

      const dot = document.createElement('span');
      dot.className = `verify-dot verify-dot--${info.state}`;
      dot.title     = info.title || 'not yet verified';

      const path = document.createElement('span');
      path.className   = 'verify-list__path';
      path.textContent = String(relPath); // XSS-safe: textContent only.

      const meta = document.createElement('span');
      meta.className = 'verify-list__meta';
      const verifyBtn = document.createElement('button');
      verifyBtn.className   = 'btn btn--small verify-list__verify';
      verifyBtn.type        = 'button';
      verifyBtn.textContent = 'Verify';
      verifyBtn.addEventListener('click', () => verifyOne(relPath));
      meta.appendChild(verifyBtn);

      li.appendChild(dot);
      li.appendChild(path);
      li.appendChild(meta);
      $verifyListItems.appendChild(li);
    }
  }

  function pushVerifyEntry(relPath) {
    if (!relPath) return;
    if (verifyState.has(relPath)) {
      // Bump to most-recent: re-insert.
      const prev = verifyState.get(relPath);
      verifyState.delete(relPath);
      verifyState.set(relPath, prev);
    } else {
      verifyState.set(relPath, { state: 'gray', title: 'not yet verified' });
    }
    // Cap at 10 entries (oldest-first eviction).
    while (verifyState.size > 10) {
      const oldest = verifyState.keys().next().value;
      verifyState.delete(oldest);
    }
    renderVerifyList();
  }

  async function verifyOne(relPath) {
    const id = relPathToId(relPath);
    try {
      const r = await getJson(`/verify/${id}`);
      const state = classifyVerifyResult(r);
      const parts = [`exists=${r.exists}`];
      if (typeof r.sizeMatches === 'boolean') parts.push(`size=${r.sizeMatches ? 'ok' : 'mismatch'}`);
      if (typeof r.shaMatches  === 'boolean') parts.push(`sha=${r.shaMatches  ? 'ok' : 'mismatch'}`);
      verifyState.set(relPath, { state, title: parts.join(', ') });
    } catch (err) {
      verifyState.set(relPath, { state: 'red', title: `verify failed: ${err.message}` });
    }
    renderVerifyList();
  }

  if ($btnVerifyAll) {
    $btnVerifyAll.addEventListener('click', async () => {
      $btnVerifyAll.disabled = true;
      try {
        // Bounded concurrency: up to 4 parallel HEADs, in declaration order.
        const relPaths = [...verifyState.keys()];
        const queue = relPaths.slice();
        const workers = [];
        const N = Math.min(4, queue.length);
        for (let i = 0; i < N; i++) {
          workers.push((async () => {
            while (queue.length) {
              const rp = queue.shift();
              await verifyOne(rp);
            }
          })());
        }
        await Promise.all(workers);
      } finally {
        $btnVerifyAll.disabled = false;
      }
    });
  }

  // Seed the verify list from sync.done frames — anything just synced is a
  // good candidate for "is THIS file actually in the pod?".
  bus.on('ws.sync.done', async () => {
    // Pull the up-to-date pending lists via /status — but /status doesn't
    // include the per-file list of just-synced names.  As a v0 we ask the
    // server for the recently-touched list via /verify across known relPaths
    // is overkill; instead we keep a soft cache populated from version.new
    // events which fire on every successful capture (push + pull).  See
    // ws.version.new handler below.
  });

  // Folio.B4 emits version.new on every successful capture (push + pull +
  // conflict resolve).  Re-use the stream to populate "Recently synced".
  bus.on('ws.version.new', (frame) => {
    if (!frame || !frame.relPath) return;
    pushVerifyEntry(frame.relPath);
  });

  // Initial render of the (empty) list so the count + empty-state line paint
  // even before any sync runs.
  renderVerifyList();
}
