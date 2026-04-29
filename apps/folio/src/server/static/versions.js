/**
 * versions.js — Folio.B4 versioning, v2.9 re-shape.
 *
 * History is no longer a primary top-level tab.  This module owns the
 * per-file history *popover*: a closed-by-default modal overlay opened
 * by a "↻ history" affordance on each file row in the conflicts list
 * and the recently-synced list inside the Status pane.
 *
 * Wire contract
 * --------------
 *   bus.emit('history.popover.open', { relPath, id })
 *       → opens the popover rooted at one file, fetches its versions
 *         from GET /versions/:id, paints them.
 *
 *   bus.emit('history.popover.close')
 *       → closes the popover (also wired to backdrop click, ×, Esc).
 *
 * Click a version → fetches GET /versions/:id/content/:ms and shows the
 * raw content read-only.  "Restore this version" POSTs to
 * /versions/:id/restore — same REST endpoint as before.
 *
 * Live:
 *   - ws.version.new   → if the popover is open and the frame's relPath
 *                        matches the active file, refresh the version list.
 *
 * XSS hardening: every user-controlled string flows through textContent.
 */

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtTs(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return String(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}
function fmtSize(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initVersions({ bus, getJson, postJson }) {
  const $popover    = document.getElementById('history-popover');
  const $backdrop   = document.getElementById('history-popover-backdrop');
  const $closeBtn   = document.getElementById('history-popover-close');
  const $relpath    = document.getElementById('history-popover-relpath');
  const $versions   = document.getElementById('history-popover-versions');
  const $viewer     = document.getElementById('history-popover-viewer');
  const $tsLabel    = document.getElementById('history-popover-ts');
  const $content    = document.getElementById('history-popover-content');
  const $btnRestore = document.getElementById('btn-history-popover-restore');
  const $btnViewerClose = document.getElementById('btn-history-popover-viewer-close');
  const $log        = document.getElementById('history-popover-log');
  if (!$popover) return null;

  /** Active file scope (popover is rooted at one file at a time). */
  let activeId  = null;     // base64url(relPath)
  let activeRel = null;
  /** Currently picked version timestamp inside the active file. */
  let activeTs  = null;

  function logEntry(msg, isErr = false) {
    if (!$log) return;
    const div = document.createElement('div');
    div.className = `log-entry${isErr ? ' log-entry--err' : ''}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    $log.appendChild(div);
    while ($log.childNodes.length > 30) $log.removeChild($log.firstChild);
  }

  // ── Popover open / close ────────────────────────────────────────────────
  function openPopover() {
    $popover.hidden = false;
    setTimeout(() => { $closeBtn?.focus(); }, 0);
    bus.emit('history.popover.opened', { relPath: activeRel, id: activeId });
  }
  function closePopover() {
    $popover.hidden = true;
    activeId  = null;
    activeRel = null;
    activeTs  = null;
    if ($viewer) $viewer.hidden = true;
    if ($content) $content.value = '';
    if ($relpath) $relpath.textContent = '—';
    // Clear the version list to avoid stale data flashing on next open.
    if ($versions) {
      while ($versions.firstChild) $versions.removeChild($versions.firstChild);
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No versions yet.';
      $versions.appendChild(empty);
    }
    bus.emit('history.popover.closed');
  }

  function renderVersions(versions) {
    while ($versions.firstChild) $versions.removeChild($versions.firstChild);
    if (!versions || versions.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No versions for this file yet.';
      $versions.appendChild(empty);
      return;
    }
    for (const v of versions) {
      const li = document.createElement('li');
      li.dataset.ts = String(v.ts);
      const ts = document.createElement('span');
      ts.className   = 'history-version-ts';
      ts.textContent = fmtTs(v.ts);
      li.appendChild(ts);
      const meta = document.createElement('span');
      meta.className   = 'history-meta';
      meta.textContent = `${fmtSize(v.size)}  ${(v.sha256 ?? '').slice(0, 8)}`;
      li.appendChild(meta);
      if (activeTs === v.ts) li.classList.add('history-list__row--active');
      li.addEventListener('click', () => pickVersion(v));
      $versions.appendChild(li);
    }
  }

  async function refreshVersions() {
    if (!activeId) {
      renderVersions([]);
      return;
    }
    try {
      const r = await getJson(`/versions/${activeId}`);
      renderVersions(r.versions ?? []);
    } catch (err) {
      logEntry(`fetch versions failed: ${err.message}`, true);
    }
  }

  async function pickVersion(v) {
    if (!activeId || !activeRel) return;
    activeTs = v.ts;
    if ($tsLabel) $tsLabel.textContent = fmtTs(v.ts);
    if ($viewer)  $viewer.hidden = false;
    try {
      const r = await fetch(`/versions/${activeId}/content/${v.ts}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      // textContent on a textarea value is text-safe by spec.
      if ($content) $content.value = text;
    } catch (err) {
      logEntry(`fetch snapshot ${v.ts} failed: ${err.message}`, true);
      if ($content) $content.value = '';
    }
    // Re-render to update the active highlight.
    refreshVersions();
  }

  async function restoreActive() {
    if (!activeId || !activeTs) return;
    try {
      const r = await postJson(`/versions/${activeId}/restore`, { ts: activeTs });
      logEntry(`restored ${activeRel} → live (was ${fmtTs(r.snapshotMsBeforeRestore)})`);
      await refreshVersions();
    } catch (err) {
      logEntry(`restore failed: ${err.message}`, true);
    }
  }

  function closeViewer() {
    activeTs = null;
    if ($viewer) $viewer.hidden = true;
    refreshVersions();
  }

  // ── Wire up ─────────────────────────────────────────────────────────────
  $btnRestore?.addEventListener('click', restoreActive);
  $btnViewerClose?.addEventListener('click', closeViewer);
  $closeBtn?.addEventListener('click', closePopover);
  $backdrop?.addEventListener('click', closePopover);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$popover.hidden) closePopover();
  });

  // Live: a new version was captured.  If it's for our active file and
  // the popover is open, refresh the list in place.
  bus.on('ws.version.new', (frame) => {
    if (!frame?.relPath) return;
    if (!$popover.hidden && activeRel && frame.relPath === activeRel) {
      refreshVersions();
    }
  });

  // Per-file popover open: rooted at one file, fetched from /versions/:id.
  bus.on('history.popover.open', async ({ relPath, id }) => {
    activeId  = id ?? null;
    activeRel = relPath ?? null;
    activeTs  = null;
    if ($relpath) $relpath.textContent = activeRel || '—';
    if ($viewer)  $viewer.hidden = true;
    if ($content) $content.value = '';
    openPopover();
    await refreshVersions();
  });
  // Programmatic / test-driven close.
  bus.on('history.popover.close', closePopover);

  // Test hook — exposes the controller so ui-tests / browser console can
  // inspect the popover state without scraping the DOM.
  return {
    openPopover,
    closePopover,
    get isOpen() { return !$popover.hidden; },
    get activeRel() { return activeRel; },
    get activeId()  { return activeId; },
    get activeTs()  { return activeTs; },
  };
}
