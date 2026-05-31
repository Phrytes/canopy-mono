/**
 * canopy-chat v2 — kring content view (web DOM renderer, SP-13.2 / v2 §1+§5).
 *
 * The screen you land on after tapping a kring tile.  Chat-style mixed
 * message stream + inline composer.  No separate chat shell exists; chat
 * IS the kring view.
 *
 * Renders per v2 §1 board "VOORBEELD 1 · BUURT":
 *
 *   [← back]  Kring name  [⋯ more]
 *             N LEDEN · functies meta
 *   ─ dated divider ─
 *   ┌─ bubble (sender)
 *   │  text
 *   │  [Ik help] [Negeer]   (per-row action chips)
 *   └─
 *   ┌─ PRIKBORD card
 *   │  "3 nieuwe vragen vandaag."
 *   └─
 *   ┌─ AANKONDIGING card
 *   │  "Buurtborrel zaterdag 17u"
 *   └─
 *   …
 *   [+] [Schrijf naar de buurt…       ] [↑]
 *
 * Pure render: the host wires:
 *   - `rows`          buildKringStream output (already scoped to this kring)
 *   - `onSend(text)`  composer submit handler
 *   - `onAction(action, row)`  per-row action chip taps
 *   - `onBack`        back-to-launcher
 *   - `more`          overflow-menu callbacks (settings / mine / files / …)
 *   - `composerPlaceholder`  kring-specific placeholder text (optional)
 *
 * Per-kring bottom tabs (GESPREK / PRIKBORD / LEDEN etc.) live in
 * SP-13.3; this slice focuses on the GESPREK render.
 */

import { actionsForStreamRow } from '../../src/v2/streamActions.js';

export function renderCircleKring(container, {
  circle = {},
  rows = [],
  onBack,
  onSend,
  onAction,
  more = null,
  composerPlaceholder = null,
  // SP-13.3 — per-kring bottom tabs (board Voorbeeld 1-3).
  // `tabs`     `[{id, label}]` produced by `buildKringTabs(policy, t)`
  // `activeTab` current tab id (defaults to first / 'gesprek')
  // `onTab(id)` host switches its content render when a tab is tapped
  tabs = null,
  activeTab = null,
  onTab,
  // SP-13.4 — Chat ↔ Scherm header pill (v2 §4 board "De Schakelaar").
  // `viewMode`   one of 'chat' | 'scherm' (default 'chat')
  // `onViewMode(mode)`  host flips between the chat-style stream and
  //   the admin-recept'd scherm-weergave.  When 'scherm' the body is
  //   a placeholder until the recept renderer lands.
  viewMode = 'chat',
  onViewMode,
  t,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-kring');

  // Header — back · title · more.
  const header = document.createElement('div');
  header.className = 'circle-kring__header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-kring__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'circle-kring__title';
  title.textContent = circle.name || circle.id || '';
  header.appendChild(title);

  // SP-13.4 — Chat ↔ Scherm pill (v2 §4 board "De Schakelaar").
  // Only renders when the host wires `onViewMode`; otherwise the
  // header stays clean (some hosts may want to suppress it).
  if (typeof onViewMode === 'function') {
    const toggle = document.createElement('div');
    toggle.className = 'circle-kring__view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', tr('circle.kring.view_toggle_label'));
    for (const mode of ['chat', 'scherm']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__view-toggle-btn';
      btn.dataset.viewMode = mode;
      if (mode === viewMode) btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', mode === viewMode ? 'true' : 'false');
      btn.textContent = tr(`circle.kring.view_${mode}`);
      btn.addEventListener('click', () => {
        if (mode !== viewMode) onViewMode(mode);
      });
      toggle.appendChild(btn);
    }
    header.appendChild(toggle);
  }

  const moreActions = collectMoreActions(more, tr);
  if (moreActions.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'circle-kring__more';
    moreBtn.setAttribute('aria-label', tr('circle.kring.more'));
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', () => {
      const menu = container.querySelector('.circle-kring__more-menu');
      if (menu) menu.classList.toggle('is-open');
    });
    header.appendChild(moreBtn);
  }
  container.appendChild(header);

  if (circle.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-kring__meta';
    meta.textContent = tr('circle.members', { count: circle.memberCount });
    container.appendChild(meta);
  }

  if (moreActions.length > 0) {
    const menu = document.createElement('div');
    menu.className = 'circle-kring__more-menu';
    for (const a of moreActions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'circle-kring__more-item';
      item.dataset.action = a.id;
      item.textContent = a.label;
      item.addEventListener('click', () => {
        menu.classList.remove('is-open');
        a.run();
      });
      menu.appendChild(item);
    }
    container.appendChild(menu);
  }

  // SP-13.3 — body switches by active tab.  GESPREK = the chat-style
  // bubble stream + day-dividers; all other tabs are placeholders for
  // now (per-tab content lands in SP-13.3-followups).  Composer stays
  // pinned at the bottom regardless — per v2 §1 all 3 voorbeeld boards
  // show the composer present whatever the body is.
  // `??` would treat the `Array.isArray && tabs[0]?.id` short-circuit's
  // false as non-nullish; fall back through plain `||` instead so the
  // no-tabs case ends up on 'gesprek' (the GESPREK render path).
  const firstTabId = Array.isArray(tabs) && tabs.length > 0 ? tabs[0].id : null;
  const effectiveTab = activeTab || firstTabId || 'gesprek';
  const body = document.createElement('div');
  body.className = 'circle-kring__list';
  body.dataset.activeTab = effectiveTab;
  body.dataset.viewMode  = viewMode;
  if (viewMode === 'scherm') {
    // SP-13.4 — placeholder until the admin-recept'd scherm renderer
    // lands.  The composer + bottom tabs are suppressed below.
    const placeholder = document.createElement('div');
    placeholder.className = 'circle-kring__placeholder';
    placeholder.textContent = tr('circle.kring.scherm_coming');
    body.appendChild(placeholder);
  } else if (effectiveTab !== 'gesprek') {
    const placeholder = document.createElement('div');
    placeholder.className = 'circle-kring__placeholder';
    placeholder.textContent = tr('circle.kring.tab_coming', {
      tab: tr(`circle.tabs.${effectiveTab}`),
    });
    body.appendChild(placeholder);
  } else if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-kring__empty';
    empty.textContent = tr('circle.kring.empty');
    body.appendChild(empty);
  } else {
    // Render chronologically (oldest at top), grouped by day.  rows from
    // buildKringStream are newest-first; reverse a copy so the timeline
    // reads top → bottom like a chat.
    const chronological = [...rows].reverse();
    let lastDayKey = null;
    for (const row of chronological) {
      const dayKey = dayKeyOf(row.ts);
      if (dayKey !== lastDayKey) {
        body.appendChild(renderDayDivider(row.ts, tr));
        lastDayKey = dayKey;
      }
      body.appendChild(renderBubble(row, { tr, onAction }));
    }
  }
  container.appendChild(body);

  // Composer — text input + send button.  Suppressed in scherm-mode
  // because the recept'd page isn't a chat surface; user flips back
  // to Chat to write something.
  if (typeof onSend === 'function' && viewMode !== 'scherm') {
    const form = document.createElement('form');
    form.className = 'circle-kring__composer';
    form.setAttribute('autocomplete', 'off');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-kring__composer-input';
    input.placeholder = composerPlaceholder ?? tr('circle.kring.composer_placeholder');
    input.setAttribute('aria-label', tr('circle.kring.composer_placeholder'));
    form.appendChild(input);

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'circle-kring__composer-send';
    send.setAttribute('aria-label', tr('circle.kring.send'));
    send.textContent = '↑';
    form.appendChild(send);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      onSend(text);
      input.value = '';
      // Keep focus so a quick burst of messages feels native.
      input.focus();
    });
    container.appendChild(form);
  }

  // SP-13.3 — per-kring bottom tab bar.  Only renders when a tabs
  // list with ≥ 2 entries is supplied (a single-tab kring has no
  // bar to switch on).  The launcher's global Kringen/Stroom/Mij
  // bar sits in a different DOM root, so the two never collide.
  // SP-13.4 — also suppress in scherm-mode (scherm is one canonical
  // page, no sub-tabs).
  if (Array.isArray(tabs) && tabs.length >= 2 && viewMode !== 'scherm') {
    const bar = document.createElement('nav');
    bar.className = 'circle-kring__tabs';
    bar.setAttribute('aria-label', tr('circle.kring.tabs_label'));
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__tab';
      btn.dataset.tab = tab.id;
      if (tab.id === effectiveTab) btn.classList.add('is-active');
      btn.textContent = tab.label ?? tr(tab.labelKey);
      btn.addEventListener('click', () => {
        if (typeof onTab === 'function' && tab.id !== effectiveTab) onTab(tab.id);
      });
      bar.appendChild(btn);
    }
    container.appendChild(bar);
  }

  return container;
}

/* ──────────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────────── */

function renderBubble(row, { tr, onAction } = {}) {
  const el = document.createElement('div');
  el.className = 'circle-kring__bubble';
  el.dataset.rowId = row.id ?? '';

  // Sender label (top-left, small).
  const senderText = pickSender(row);
  if (senderText) {
    const sender = document.createElement('div');
    sender.className = 'circle-kring__bubble-sender';
    sender.textContent = senderText;
    el.appendChild(sender);
  }

  // Kind pill (small, inline before text — matches the v2 PRIKBORD card
  // shape).  For chat-only messages the kind is null and no pill renders.
  const kind = pickKindLabel(row);
  if (kind) {
    const tag = document.createElement('span');
    tag.className = 'circle-kring__bubble-kind';
    tag.textContent = kind;
    el.appendChild(tag);
  }

  const text = document.createElement('div');
  text.className = 'circle-kring__bubble-text';
  text.textContent = pickRowText(row) ?? tr(`circle.streamAction.${row.type ?? 'unknown'}`) ?? '';
  el.appendChild(text);

  // Per-row action chips (Ik help / Negeer / Ik doe ze …).  Substrate
  // already picks the right set per row kind.
  const actions = actionsForStreamRow(row);
  if (actions.length) {
    const actRow = document.createElement('div');
    actRow.className = 'circle-kring__bubble-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__bubble-action';
      btn.dataset.action = a.action;
      btn.textContent = tr(a.label);
      btn.addEventListener('click', () => {
        if (typeof onAction === 'function') onAction(a, row);
      });
      actRow.appendChild(btn);
    }
    el.appendChild(actRow);
  }

  return el;
}

function renderDayDivider(ts, tr) {
  const el = document.createElement('div');
  el.className = 'circle-kring__day';
  el.textContent = formatDayLabel(ts, tr);
  return el;
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  // YYYY-MM-DD — local-time day key (avoid UTC drift across timezones).
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDayLabel(ts, tr) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (sameDay)     return tr('circle.kring.day_today');
  if (isYesterday) return tr('circle.kring.day_yesterday');
  return d.toLocaleDateString();
}

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return null;
}

function pickKindLabel(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  const k = typeof p.kind === 'string' && p.kind ? p.kind : null;
  // Don't show a kind pill for plain chat messages — they're the default.
  if (!k || k === 'message' || k === 'chat-message') return null;
  return k.toUpperCase();
}

function pickSender(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['senderDisplay', 'authorName', 'displayName', 'actor']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  if (typeof row?.actor === 'string' && row.actor) return row.actor;
  return null;
}

const MORE_ITEMS = [
  { key: 'settings', labelKey: 'circle.settings.title' },
  { key: 'mine',     labelKey: 'circle.override.title' },
  { key: 'viewAs',   labelKey: 'circle.viewAs.title' },
  { key: 'advisor',  labelKey: 'circle.advisor.title' },
  { key: 'skills',   labelKey: 'circle.skills.editor_title' },
  { key: 'files',    labelKey: 'circle.folio.title' },
  { key: 'rules',    labelKey: 'circle.rules.title' },
];

function collectMoreActions(more, tr) {
  if (!more || typeof more !== 'object') return [];
  const out = [];
  for (const item of MORE_ITEMS) {
    const fn = more[item.key];
    if (typeof fn === 'function') {
      out.push({ id: item.key, label: tr(item.labelKey), run: fn });
    }
  }
  return out;
}
