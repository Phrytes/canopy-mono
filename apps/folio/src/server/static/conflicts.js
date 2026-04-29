/**
 * conflicts.js — Conflicts pane.
 *
 * Renders the list of open conflicts (GET /conflicts), and on row click
 * shows a 3-pane merge view with CodeMirror as the merged editor.
 *
 * Resolve buttons:
 *   - "Keep mine"   → POST /conflicts/:id/resolve { resolution: 'mine' }
 *   - "Keep theirs" → POST /conflicts/:id/resolve { resolution: 'theirs' }
 *   - "Save merged" → POST /conflicts/:id/resolve { resolution: <text> }
 *
 * Live updates:
 *   - ws.conflict.new   → re-fetch /conflicts and re-render the list
 *   - ws.sync.done      → re-fetch /conflicts (some may be cleared)
 */

const CONFLICT_RE = /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*\n?/gm;

/**
 * Extract one side ('mine' or 'theirs') of a git-style conflict block.
 * Returns null if no conflict markers are found.
 */
function extractSide(text, side) {
  const re = new RegExp(CONFLICT_RE.source, CONFLICT_RE.flags);
  let lastIndex = 0;
  let result = '';
  let matched = false;
  let match;
  while ((match = re.exec(text)) !== null) {
    matched = true;
    result += text.slice(lastIndex, match.index);
    result += side === 'mine' ? match[1] : match[2];
    lastIndex = re.lastIndex;
  }
  if (!matched) return null;
  result += text.slice(lastIndex);
  return result;
}

export function initConflicts({ bus, getJson, postJson }) {
  const $list      = document.getElementById('conflict-list');
  const $tabBadge  = document.getElementById('tab-conflicts-count');
  const $region    = document.getElementById('merge-region');
  const $relPath   = document.getElementById('merge-relpath');
  const $mine      = document.getElementById('merge-mine');
  const $theirs    = document.getElementById('merge-theirs');
  const $merged    = document.getElementById('merge-merged');
  const $log       = document.getElementById('merge-log');
  const $btnMine   = document.getElementById('btn-keep-mine');
  const $btnTheirs = document.getElementById('btn-keep-theirs');
  const $btnSaveMerged = document.getElementById('btn-save-merged');
  const $btnCancel = document.getElementById('btn-cancel-merge');

  let cmEditor   = null;     // CodeMirror instance for the merged pane (if available)
  let activeId   = null;
  let activeRel  = null;

  function logEntry(msg, isErr = false) {
    const div = document.createElement('div');
    div.className = `log-entry${isErr ? ' log-entry--err' : ''}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    $log.appendChild(div);
    while ($log.childNodes.length > 30) $log.removeChild($log.firstChild);
  }

  function setBadge(n) {
    $tabBadge.textContent = n > 0 ? String(n) : '';
  }

  function renderList(conflicts) {
    // Clear safely.
    while ($list.firstChild) $list.removeChild($list.firstChild);
    if (!conflicts || conflicts.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No conflicts.';
      $list.appendChild(empty);
      setBadge(0);
      return;
    }
    setBadge(conflicts.length);
    for (const c of conflicts) {
      const li = document.createElement('li');
      li.dataset.id      = c.id;
      li.dataset.relPath = c.relPath;
      const code = document.createElement('code');
      // textContent — never trust file paths.
      code.textContent = c.relPath;
      li.appendChild(code);

      // Folio.B4 — "View history" link jumps to the History tab pre-loaded
      // with this file.  Stop-propagation so it doesn't double-fire the
      // openMerge() handler bound to the row.
      const historyLink = document.createElement('a');
      historyLink.className   = 'conflict-history-link';
      historyLink.href        = '#history';
      historyLink.textContent = 'View history';
      historyLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Tell the history pane which file we want…
        bus.emit('history.openFor', { relPath: c.relPath, id: c.id });
        // …and switch to that tab.
        const tab = document.getElementById('tab-history');
        if (tab) tab.click();
      });
      li.appendChild(historyLink);

      li.addEventListener('click', () => openMerge(c));
      $list.appendChild(li);
    }
  }

  async function refreshList() {
    try {
      const r = await getJson('/conflicts');
      renderList(r.conflicts ?? []);
    } catch (err) {
      // Render an empty list with an error note in the log.
      logEntry(`fetch conflicts failed: ${err.message}`, true);
    }
  }

  function getMergedText() {
    return cmEditor ? cmEditor.getValue() : $merged.value;
  }
  function setMergedText(text) {
    if (cmEditor) cmEditor.setValue(text);
    else $merged.value = text;
  }

  async function openMerge(c) {
    activeId  = c.id;
    activeRel = c.relPath;
    $relPath.textContent = c.relPath;
    $region.hidden = false;

    // Fetch the raw file content via the GET /conflicts/:id/content
    // endpoint (added by B1.ui — see routes.js).  Server-side this is
    // path-confined to localRoot and rejects '..' segments.  Response is
    // text/plain; we keep it as a string and split into mine/theirs/
    // merged client-side via extractSide().
    let text;
    try {
      const r = await fetch(`/conflicts/${c.id}/content`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    } catch (err) {
      logEntry(`could not read ${c.relPath}: ${err.message}`, true);
      $mine.value = '';
      $theirs.value = '';
      setMergedText('');
      return;
    }

    const mine   = extractSide(text, 'mine')   ?? '';
    const theirs = extractSide(text, 'theirs') ?? '';
    $mine.value   = mine;
    $theirs.value = theirs;
    // Initial merged content — just keep the raw file with markers, so the
    // user sees what they're resolving.
    setMergedText(text);
  }

  function closeMerge() {
    activeId = null;
    activeRel = null;
    $region.hidden = true;
  }

  async function resolveActive(resolution) {
    if (!activeId) return;
    try {
      await postJson(`/conflicts/${activeId}/resolve`, { resolution });
      logEntry(`resolved ${activeRel}`);
      closeMerge();
      await refreshList();
    } catch (err) {
      logEntry(`resolve failed: ${err.message}`, true);
    }
  }

  // ── Wire up ─────────────────────────────────────────────────────────────
  $btnMine.addEventListener('click',   () => resolveActive('mine'));
  $btnTheirs.addEventListener('click', () => resolveActive('theirs'));
  $btnSaveMerged.addEventListener('click', () => {
    const text = getMergedText();
    if (typeof text !== 'string' || text.length === 0) {
      logEntry('refusing to save an empty merged buffer', true);
      return;
    }
    resolveActive(text);
  });
  $btnCancel.addEventListener('click', closeMerge);

  bus.on('ws.conflict.new', () => { refreshList(); });
  bus.on('ws.sync.done',    () => { refreshList(); });

  // Re-fetch conflicts when the user opens the conflicts tab.
  bus.on('tab.change', (paneId) => {
    if (paneId === 'pane-conflicts') refreshList();
  });

  // First paint.
  refreshList();

  // Lazy CodeMirror upgrade: if the CodeMirror global is available, attach
  // it to the merged textarea for syntax highlighting + nice editor feel.
  if (window.CodeMirror) {
    try {
      cmEditor = window.CodeMirror.fromTextArea($merged, {
        mode:        'text/markdown',
        lineNumbers: true,
        lineWrapping: true,
      });
      cmEditor.setSize('100%', '12rem');
    } catch (err) {
      // If CodeMirror init fails for any reason, fall back to the textarea.
      cmEditor = null;
    }
  }
}
