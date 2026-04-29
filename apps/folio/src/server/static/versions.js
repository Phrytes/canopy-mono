/**
 * versions.js — Folio.B4 "History" pane.
 *
 * Two-column layout:
 *   - Left:  every relPath that has at least one snapshot, fetched from
 *            GET /versions.
 *   - Right: every snapshot for the picked relPath, fetched from
 *            GET /versions/:id.
 *
 * Click a version row → fetches GET /versions/:id/content/:ms and shows the
 * raw content read-only.  "Restore this version" POSTs to
 * /versions/:id/restore.
 *
 * Live:
 *   - ws.version.new   → if the active relPath matches, refresh.
 *   - tab.change       → re-fetch both lists when re-opening the tab.
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
  const $files     = document.getElementById('history-file-list');
  const $versions  = document.getElementById('history-version-list');
  const $rel       = document.getElementById('history-active-relpath');
  const $tsLabel   = document.getElementById('history-active-ts');
  const $viewer    = document.getElementById('history-viewer');
  const $content   = document.getElementById('history-content');
  const $btnRestore = document.getElementById('btn-history-restore');
  const $btnClose  = document.getElementById('btn-history-close');
  const $log       = document.getElementById('history-log');

  let activeId  = null;     // base64url(relPath) of the picked file
  let activeRel = null;
  let activeTs  = null;

  function logEntry(msg, isErr = false) {
    const div = document.createElement('div');
    div.className = `log-entry${isErr ? ' log-entry--err' : ''}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    $log.appendChild(div);
    while ($log.childNodes.length > 30) $log.removeChild($log.firstChild);
  }

  function renderFiles(files) {
    while ($files.firstChild) $files.removeChild($files.firstChild);
    if (!files || files.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No history yet.';
      $files.appendChild(empty);
      return;
    }
    for (const f of files) {
      const li = document.createElement('li');
      li.dataset.id      = f.id;
      li.dataset.relPath = f.relPath;
      const code = document.createElement('code');
      code.textContent = f.relPath;
      li.appendChild(code);
      const meta = document.createElement('span');
      meta.className = 'history-meta';
      meta.textContent = `${f.count}×  ${fmtTs(f.latestMs)}`;
      li.appendChild(meta);
      if (activeRel === f.relPath) li.classList.add('history-list__row--active');
      li.addEventListener('click', () => pickFile(f));
      $files.appendChild(li);
    }
  }

  function renderVersions(versions) {
    while ($versions.firstChild) $versions.removeChild($versions.firstChild);
    if (!versions || versions.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No versions for this file.';
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

  async function refreshFiles() {
    try {
      const r = await getJson('/versions');
      renderFiles(r.files ?? []);
    } catch (err) {
      logEntry(`fetch /versions failed: ${err.message}`, true);
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

  async function pickFile(f) {
    activeId  = f.id;
    activeRel = f.relPath;
    activeTs  = null;
    $rel.textContent = f.relPath;
    $viewer.hidden = true;
    await refreshVersions();
    // Re-render files to update the active highlight.
    refreshFiles();
  }

  async function pickVersion(v) {
    if (!activeId || !activeRel) return;
    activeTs = v.ts;
    $tsLabel.textContent = fmtTs(v.ts);
    $viewer.hidden = false;
    try {
      const r = await fetch(`/versions/${activeId}/content/${v.ts}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      // textContent — never innerHTML — even though this is just a value
      // assignment to a textarea (which is text-safe by spec).
      $content.value = text;
    } catch (err) {
      logEntry(`fetch snapshot ${v.ts} failed: ${err.message}`, true);
      $content.value = '';
    }
    // Update version-list highlights.
    refreshVersions();
  }

  async function restoreActive() {
    if (!activeId || !activeTs) return;
    try {
      const r = await postJson(`/versions/${activeId}/restore`, { ts: activeTs });
      logEntry(`restored ${activeRel} → live (was ${fmtTs(r.snapshotMsBeforeRestore)})`);
      // Force a status + history refresh.
      await refreshFiles();
      await refreshVersions();
    } catch (err) {
      logEntry(`restore failed: ${err.message}`, true);
    }
  }

  function closeViewer() {
    activeTs = null;
    $viewer.hidden = true;
    refreshVersions();
  }

  // ── Wire up ─────────────────────────────────────────────────────────────
  $btnRestore.addEventListener('click', restoreActive);
  $btnClose.addEventListener('click',   closeViewer);

  // Live: a version was captured.  If it's for our active file (or if no
  // file is active yet), refresh the lists.
  bus.on('ws.version.new', (frame) => {
    if (frame?.relPath && activeRel && frame.relPath === activeRel) {
      refreshVersions();
    }
    // File picker may need a count bump.
    refreshFiles();
  });

  // Re-fetch when the tab is opened.
  bus.on('tab.change', (paneId) => {
    if (paneId === 'pane-history') {
      refreshFiles();
      refreshVersions();
    }
  });

  // Cross-pane: a "view history" link from the conflicts pane sets the
  // active file then switches to this tab.
  bus.on('history.openFor', async ({ relPath, id }) => {
    activeId  = id ?? null;
    activeRel = relPath ?? null;
    activeTs  = null;
    $rel.textContent = activeRel || '—';
    $viewer.hidden = true;
    await refreshFiles();
    await refreshVersions();
  });

  // First paint (best-effort).
  refreshFiles();
}
