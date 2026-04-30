/**
 * history.js — top-level History pane.
 *
 * Renders the list of every file that has at least one snapshot, newest
 * first.  Clicking a row opens the per-file history popover (the same
 * one used by the recently-synced list and conflicts), so list +
 * detail share a single restore code path.
 *
 * Data feed: GET /versions returns
 *   { ts, files: [{ id, relPath, latestMs, count }] }
 *
 * Live updates:
 *   - ws.version.new   → refetch + re-render (any file gained a version)
 *   - bus 'tab.change' to 'pane-history' → refetch on tab activation,
 *     so a user that toggled away and came back gets fresh data
 *
 * Per-file popover wiring (already in versions.js):
 *   bus.emit('history.popover.open', { relPath, id })
 *
 * XSS hardening: all user-controlled strings via textContent.
 */

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtTs(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return String(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

function fmtRelative(ms) {
  const now = Date.now();
  const diff = Math.max(0, now - Number(ms));
  const s = Math.floor(diff / 1000);
  if (s < 60)        return 'just now';
  if (s < 3600)      return `${Math.floor(s / 60)} min ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtTs(ms);
}

export function initHistory({ bus, getJson }) {
  const $list    = document.getElementById('history-list');
  const $count   = document.getElementById('history-count');
  const $tabBadge = document.getElementById('tab-history-count');
  const $refresh = document.getElementById('btn-history-refresh');
  if (!$list) return null;

  /** Last-fetched files array; preserved across re-renders so we can
   *  resolve clicks back to {id, relPath} without re-querying. */
  let files = [];

  function setBadge(n) {
    if (!$tabBadge) return;
    $tabBadge.textContent = n > 0 ? String(n) : '';
    $tabBadge.classList.toggle('badge--zero', n === 0);
  }

  function render() {
    $list.innerHTML = '';
    if ($count) $count.textContent = files.length === 0
      ? ''
      : `${files.length} file${files.length === 1 ? '' : 's'}`;
    setBadge(files.length);
    if (files.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No history yet — edit a note to capture the first snapshot.';
      $list.appendChild(li);
      return;
    }
    for (const f of files) {
      const li = document.createElement('li');
      li.className = 'history-pane__row';

      const main = document.createElement('div');
      main.className = 'history-pane__main';

      const name = document.createElement('span');
      name.className = 'history-pane__path';
      name.textContent = f.relPath;
      main.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'history-pane__meta';
      const c = Number(f.count) || 0;
      meta.textContent = `${c} version${c === 1 ? '' : 's'} · last ${fmtRelative(f.latestMs)}`;
      main.appendChild(meta);

      li.appendChild(main);

      const view = document.createElement('button');
      view.className = 'btn btn--ghost btn--small';
      view.type = 'button';
      view.textContent = 'View / restore';
      view.addEventListener('click', () => {
        bus.emit('history.popover.open', { relPath: f.relPath, id: f.id });
      });
      li.appendChild(view);

      $list.appendChild(li);
    }
  }

  async function refresh() {
    try {
      const data = await getJson('/versions');
      files = Array.isArray(data?.files) ? data.files.slice() : [];
      // Sort newest-first by latestMs (server returns newest-first per
      // routes.js, but defending against re-ordering elsewhere).
      files.sort((a, b) => Number(b.latestMs) - Number(a.latestMs));
      render();
    } catch (err) {
      $list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = `Failed to load history: ${err?.message ?? err}`;
      $list.appendChild(li);
      setBadge(0);
    }
  }

  // Wire refresh button.
  if ($refresh) $refresh.addEventListener('click', refresh);

  // Refetch on tab activation so the count stays fresh when the user
  // toggles between Status/Conflicts/Share/History.
  if (bus && typeof bus.on === 'function') {
    bus.on('tab.change', (paneId) => {
      if (paneId === 'pane-history') refresh();
    });
    // Live updates from the engine.
    bus.on('ws.version.new', refresh);
  }

  // Initial fetch — preloads the badge count even before the user
  // navigates to the tab.
  refresh();

  return { refresh };
}
