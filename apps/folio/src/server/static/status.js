/**
 * status.js — Status pane.
 *
 * Subscribes to:
 *   - status.snapshot          (initial paint from GET /status)
 *   - ws.status                (WS frame; partial — stats + watching)
 *   - ws.sync.progress         (transient; renders in log)
 *   - ws.sync.done             (re-fetch /status to refresh pending counts)
 *   - ws.error                 (renders in log)
 *
 * Buttons:
 *   - #btn-sync-now      → POST /sync/now {direction:'both'}
 *   - #btn-watch-toggle  → POST /watch/start | /watch/stop
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

  bus.on('ws.error', (frame) => {
    logEntry(`error in ${frame.phase}${frame.relPath ? ' ('+frame.relPath+')' : ''}: ${frame.message}`, true);
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
}
