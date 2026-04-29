/**
 * settings.js — Folio v2.3 Settings panel controller.
 *
 * The Settings panel is reached via the small "Settings" link in the
 * header (NOT a primary tab — primary tabs remain Status / Conflicts /
 * Share / History).  v2.3 ships one inhabitant: a Diagnostics section
 * that streams the same 16-step `folio doctor` engine over the existing
 * /events WebSocket.
 *
 * Wire contract
 *
 *   - `Run diagnostics` button  → POST /diagnostics
 *     - 202 → wait for `diagnostics.step` frames (one per step) and a
 *             closing `diagnostics.done`
 *     - 409 → inline notice + leave the previous run's output visible
 *
 *   - WebSocket frames consumed via the bus in `app.js`:
 *       ws.diagnostics.step  → render / update one row
 *       ws.diagnostics.done  → enable Run button, surface summary + fix
 *
 * Hard rules (v2.3 spec):
 *   - NO new top-level Diagnostics tab.  This file MUST NOT touch the
 *     `.tabs` / `.pane` markup.
 *   - All step labels / details are rendered with `textContent` only —
 *     the WS frame fields are server-trusted JSON, never HTML.
 *   - Concurrent-run guard is server-side (409).  The client just shows
 *     a friendly "already running" notice and keeps the existing list.
 */

const STATUS_DOT_CLASS = {
  PASS: 'diagnostic-row__dot--pass',
  WARN: 'diagnostic-row__dot--warn',
  FAIL: 'diagnostic-row__dot--fail',
  SKIP: 'diagnostic-row__dot--skip',
};

const STATUS_LABEL = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
  SKIP: 'SKIP',
  PENDING: '…',
};

/**
 * Initialize the Settings panel.
 *
 * @param {object} deps
 * @param {{ on: Function, emit: Function }} deps.bus    — central event bus from app.js
 * @param {(path: string, payload?: any) => Promise<any>} deps.postJson
 */
export function initSettings({ bus, postJson }) {
  const $panel    = document.getElementById('settings-panel');
  const $backdrop = document.getElementById('settings-panel-backdrop');
  const $openBtn  = document.getElementById('settings-open-btn');
  const $closeBtn = document.getElementById('settings-close-btn');
  if (!$panel || !$openBtn) return null;

  // Diagnostics surface inside the panel.
  const $runBtn   = document.getElementById('btn-diagnostics-run');
  const $list     = document.getElementById('diagnostics-list');
  const $summary  = document.getElementById('diagnostics-summary');
  const $fix      = document.getElementById('diagnostics-fix');

  let isRunning = false;
  /** Map<id, HTMLElement> of step rows so updates rewrite in place. */
  const rowsById = new Map();

  // ── Open / close the panel ──────────────────────────────────────────────
  function openPanel() {
    $panel.hidden = false;
    // Focus the close button so Esc/Enter/Tab make sense for keyboard users.
    setTimeout(() => { $closeBtn?.focus(); }, 0);
    bus.emit('settings.opened');
  }
  function closePanel() {
    $panel.hidden = true;
    bus.emit('settings.closed');
  }
  $openBtn.addEventListener('click', openPanel);
  $closeBtn?.addEventListener('click', closePanel);
  $backdrop?.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$panel.hidden) closePanel();
  });

  // ── Diagnostics rendering ───────────────────────────────────────────────
  function clearList() {
    while ($list.firstChild) $list.removeChild($list.firstChild);
    rowsById.clear();
  }

  function makeRow({ id, label, status, detail }) {
    const li = document.createElement('li');
    li.className = 'diagnostic-row';
    li.dataset.stepId = id;

    const dot = document.createElement('span');
    dot.className = `diagnostic-row__dot ${STATUS_DOT_CLASS[status] ?? ''}`;
    dot.setAttribute('aria-hidden', 'true');
    li.appendChild(dot);

    const labelEl = document.createElement('span');
    labelEl.className = 'diagnostic-row__label';
    labelEl.textContent = label ?? id;          // textContent — XSS hardening.
    li.appendChild(labelEl);

    const statusEl = document.createElement('span');
    statusEl.className = 'diagnostic-row__status';
    statusEl.textContent = STATUS_LABEL[status] ?? status;
    li.appendChild(statusEl);

    if (detail) {
      const detailEl = document.createElement('span');
      detailEl.className = 'diagnostic-row__detail';
      detailEl.textContent = String(detail);
      li.appendChild(detailEl);
    }

    return li;
  }

  function updateRow(frame) {
    const existing = rowsById.get(frame.id);
    if (existing) {
      // Update the dot + status + detail text.  Keep the label for stability.
      const dot = existing.querySelector('.diagnostic-row__dot');
      if (dot) {
        dot.className = `diagnostic-row__dot ${STATUS_DOT_CLASS[frame.status] ?? ''}`;
      }
      const statusEl = existing.querySelector('.diagnostic-row__status');
      if (statusEl) statusEl.textContent = STATUS_LABEL[frame.status] ?? frame.status;
      const labelEl = existing.querySelector('.diagnostic-row__label');
      if (labelEl) labelEl.textContent = frame.label ?? frame.id;
      let detailEl = existing.querySelector('.diagnostic-row__detail');
      if (frame.detail) {
        if (!detailEl) {
          detailEl = document.createElement('span');
          detailEl.className = 'diagnostic-row__detail';
          existing.appendChild(detailEl);
        }
        detailEl.textContent = String(frame.detail);
      } else if (detailEl) {
        detailEl.remove();
      }
      return;
    }
    const row = makeRow(frame);
    $list.appendChild(row);
    rowsById.set(frame.id, row);
  }

  function renderSummary({ ok, counts }) {
    if (!counts) {
      $summary.textContent = '';
      return;
    }
    const parts = [];
    if (typeof counts.PASS === 'number') parts.push(`${counts.PASS} PASS`);
    if (typeof counts.WARN === 'number') parts.push(`${counts.WARN} WARN`);
    if (typeof counts.FAIL === 'number') parts.push(`${counts.FAIL} FAIL`);
    if (typeof counts.SKIP === 'number' && counts.SKIP > 0) parts.push(`${counts.SKIP} SKIP`);
    $summary.textContent = `${ok ? 'Healthy' : 'Issues found'} — ${parts.join(' / ')}`;
    $summary.classList.toggle('diagnostics-summary--ok', !!ok);
    $summary.classList.toggle('diagnostics-summary--bad', !ok);
  }

  function renderFix(text) {
    if (!text) {
      $fix.hidden = true;
      $fix.textContent = '';
      return;
    }
    $fix.hidden = false;
    $fix.textContent = `Recommended fix: ${text}`;
  }

  // ── Run button ──────────────────────────────────────────────────────────
  $runBtn?.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    $runBtn.disabled = true;
    $runBtn.textContent = 'Running…';
    clearList();
    renderSummary({ ok: null, counts: null });
    renderFix(null);

    try {
      await postJson('/diagnostics', {});
    } catch (err) {
      isRunning = false;
      $runBtn.disabled = false;
      $runBtn.textContent = 'Run diagnostics';
      if (err?.status === 409) {
        $summary.textContent = 'A diagnostics run is already in progress.';
        $summary.className = 'diagnostics-summary diagnostics-summary--bad';
      } else {
        $summary.textContent = `Could not start diagnostics: ${err?.message ?? String(err)}`;
        $summary.className = 'diagnostics-summary diagnostics-summary--bad';
      }
    }
  });

  // ── WS frames ───────────────────────────────────────────────────────────
  bus.on('ws.diagnostics.step', (frame) => {
    if (!frame) return;
    updateRow(frame);
  });
  bus.on('ws.diagnostics.done', (frame) => {
    isRunning = false;
    if ($runBtn) {
      $runBtn.disabled = false;
      $runBtn.textContent = 'Run diagnostics';
    }
    if (!frame) return;
    renderSummary({ ok: !!frame.ok, counts: frame.counts ?? {} });
    renderFix(frame.recommendedFix ?? null);
  });

  // Test hook — exposes the row map + flags so ui.test.js / browser console
  // can inspect the current state without scraping the DOM.
  return {
    openPanel,
    closePanel,
    get isOpen() { return !$panel.hidden; },
    get isRunning() { return isRunning; },
    rowFor(id) { return rowsById.get(id) ?? null; },
  };
}
