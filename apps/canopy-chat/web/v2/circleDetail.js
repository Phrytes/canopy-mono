/**
 * canopy-chat v2 — circle detail (web DOM renderer).
 *
 * The scoped view you land on when opening a circle from the launcher
 * (F1). Pure render: back action + circle header + a list of the
 * circle's (already-scoped) items. Host fetches + scopes the items
 * (via `scopeItems`); this stays unit-testable under happy-dom.
 */

export function renderCircleDetail(container, {
  circle = {},
  items = [],
  t,
  onBack,
  onSettings,
  onMine,
  onViewAs,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-detail');

  const bar = document.createElement('div');
  bar.className = 'circle-detail__bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-detail__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => {
    if (typeof onBack === 'function') onBack();
  });
  bar.appendChild(back);
  if (typeof onMine === 'function') {
    const mine = document.createElement('button');
    mine.type = 'button';
    mine.className = 'circle-detail__mine';
    mine.textContent = tr('circle.override.title');
    mine.addEventListener('click', () => onMine());
    bar.appendChild(mine);
  }
  if (typeof onSettings === 'function') {
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'circle-detail__settings';
    gear.textContent = tr('circle.settings.title');
    gear.addEventListener('click', () => onSettings());
    bar.appendChild(gear);
  }
  if (typeof onViewAs === 'function') {
    const va = document.createElement('button');
    va.type = 'button';
    va.className = 'circle-detail__viewas';
    va.textContent = tr('circle.viewAs.title');
    va.addEventListener('click', () => onViewAs());
    bar.appendChild(va);
  }
  container.appendChild(bar);

  const head = document.createElement('h2');
  head.className = 'circle-detail__title';
  head.textContent = circle.name || circle.id || '';
  container.appendChild(head);

  if (circle.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-detail__meta';
    meta.textContent = tr('circle.members', { count: circle.memberCount });
    container.appendChild(meta);
  }

  const list = document.createElement('div');
  list.className = 'circle-detail__items';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-detail__empty';
    empty.textContent = tr('circle.detail_empty');
    list.appendChild(empty);
  } else {
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'circle-detail__item';
      row.textContent = itemLabel(it);
      list.appendChild(row);
    }
  }
  container.appendChild(list);
  return container;
}

function itemLabel(it = {}) {
  return it.title || it.text || it.name || it.label || String(it.id ?? '');
}
