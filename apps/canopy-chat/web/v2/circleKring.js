/**
 * canopy-chat v2 — kring content view (web DOM renderer, SP-13 / board 2B + 8C).
 *
 * The screen you land on after tapping a kring tile on the launcher
 * (when `policy.view !== 'chat'`).  Pure render — host wires:
 *   - `circle`           the active kring object
 *   - `rows`             pre-filtered `buildKringStream({circleId, kindFilter})` output
 *   - `filter`           current chip key (one of KRING_STREAM_KIND_FILTERS) + `onFilter(key)`
 *   - `actions`          `actionsForStreamRow` output keyed by row id (optional)
 *   - `onBack` / `onPost` / `onAction(action, row)`
 *   - `more` actions map: `{ settings, mine, viewAs, advisor, skills, files, rules }`
 *     — each is an optional callback; rendered in the overflow menu when set.
 *     (The host gates these on the kring's Functies axis upstream.)
 *
 * Layout per board 2B (right-hand side adapted for the full Onderling
 * launcher context):
 *   [← back]  Kring name  [⋯ more]
 *             member-count meta
 *   [Alles] [Vraag] [Aanbod] [Lenen]
 *   ┌─ rows
 *   │  KIND · text · actor · ts
 *   │  [Ik help] [Negeer]
 *   └─
 *   [+ plaats vraag · aanbod · te leen]  (FAB)
 *
 * The bottom Kringen/Stroom/Mij tab bar is rendered by the host shell,
 * not by this renderer.
 */

import { KRING_STREAM_KIND_FILTERS } from '../../src/v2/circleStream.js';
import { actionsForStreamRow }      from '../../src/v2/streamActions.js';

export function renderCircleKring(container, {
  circle = {},
  rows = [],
  filter = 'all',
  onFilter,
  onBack,
  onPost,
  onAction,
  more = null,
  t,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-kring');

  // Header: back · title · more.
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

  // Overflow `⋯` opens an inline action list; only shown when at least
  // one `more.*` handler is wired.  The list is appended below the
  // header (no positioning library), toggled via an `is-open` class.
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

  // Filter chip row (Alles / Vraag / Aanbod / Lenen).
  const chips = document.createElement('div');
  chips.className = 'circle-kring__chips';
  for (const key of KRING_STREAM_KIND_FILTERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'circle-kring__chip';
    chip.dataset.filter = key;
    if (key === filter) chip.classList.add('is-active');
    chip.textContent = tr(`circle.kring.filter_${key}`);
    chip.addEventListener('click', () => {
      if (typeof onFilter === 'function') onFilter(key);
    });
    chips.appendChild(chip);
  }
  container.appendChild(chips);

  // Rows list / empty state.
  const list = document.createElement('div');
  list.className = 'circle-kring__list';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-kring__empty';
    empty.textContent = filter && filter !== 'all'
      ? tr('circle.kring.empty_filtered')
      : tr('circle.kring.empty');
    list.appendChild(empty);
  } else {
    for (const row of rows) {
      list.appendChild(renderRow(row, { tr, onAction }));
    }
  }
  container.appendChild(list);

  // + plaats FAB.
  if (typeof onPost === 'function') {
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'circle-kring__fab';
    fab.textContent = tr('circle.kring.post_fab');
    fab.addEventListener('click', () => onPost());
    container.appendChild(fab);
  }

  return container;
}

function renderRow(row, { tr, onAction } = {}) {
  const el = document.createElement('div');
  el.className = 'circle-kring__row';
  el.dataset.rowId = row.id ?? '';

  const head = document.createElement('div');
  head.className = 'circle-kring__row-head';
  const kind = pickKindLabel(row);
  if (kind) {
    const tag = document.createElement('span');
    tag.className = 'circle-kring__row-kind';
    tag.textContent = kind;
    head.appendChild(tag);
  }
  const text = document.createElement('span');
  text.className = 'circle-kring__row-text';
  text.textContent = pickRowText(row) ?? tr(`circle.streamAction.${row.type ?? 'unknown'}`) ?? '';
  head.appendChild(text);
  el.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'circle-kring__row-meta';
  meta.textContent = [row.actor, row.app].filter(Boolean).join(' · ');
  el.appendChild(meta);

  const actions = actionsForStreamRow(row);
  if (actions.length) {
    const actRow = document.createElement('div');
    actRow.className = 'circle-kring__row-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__row-action';
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

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return null;
}

function pickKindLabel(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  const k = typeof p.kind === 'string' && p.kind ? p.kind : row.type;
  return typeof k === 'string' && k ? k.toUpperCase() : null;
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
