/**
 * canopy-chat v2 — circle detail (web DOM renderer).
 *
 * The scoped view you land on when opening a circle from the launcher
 * (F1). Pure render: back action + circle header + a list of the
 * circle's (already-scoped) items. Host fetches + scopes the items
 * (via `scopeItems`); this stays unit-testable under happy-dom.
 *
 * 5.9d — passive Proof-of-Location row sits between the header meta
 * and the items list. Host probes `getPolStatus` via the shared
 * `getCirclePolStatus` helper and passes a `{configured,…}` shape in
 * as `pol`; we just render. Placeholder seam — real attestation in
 * [[5.9d-followup]].
 */
import { formatPolStatus } from '../../src/v2/circlePol.js';
import { isFeatureEnabled } from '../../src/v2/circlePolicy.js';

export function renderCircleDetail(container, {
  circle = {},
  items = [],
  pol = null,
  // P6.1 — when supplied, gate feature-bound action buttons on its
  // Functies axis (board 4A).  Null/undefined → feature defaults apply
  // (chat / houseRules / memberDirectory on by default).
  policy = null,
  t,
  onBack,
  onSettings,
  onMine,
  onViewAs,
  onAdvisor,
  onSkills,
  onFiles,
  onRules,
} = {}) {
  const showRules  = isFeatureEnabled(policy, 'houseRules');
  const showViewAs = isFeatureEnabled(policy, 'memberDirectory');
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
  if (typeof onViewAs === 'function' && showViewAs) {
    const va = document.createElement('button');
    va.type = 'button';
    va.className = 'circle-detail__viewas';
    va.textContent = tr('circle.viewAs.title');
    va.addEventListener('click', () => onViewAs());
    bar.appendChild(va);
  }
  if (typeof onAdvisor === 'function') {
    const adv = document.createElement('button');
    adv.type = 'button';
    adv.className = 'circle-detail__advisor';
    adv.textContent = tr('circle.advisor.title');
    adv.addEventListener('click', () => onAdvisor());
    bar.appendChild(adv);
  }
  if (typeof onSkills === 'function') {
    const sk = document.createElement('button');
    sk.type = 'button';
    sk.className = 'circle-detail__skills';
    sk.textContent = tr('circle.skills.editor_title');
    sk.addEventListener('click', () => onSkills());
    bar.appendChild(sk);
  }
  if (typeof onFiles === 'function') {
    const fi = document.createElement('button');
    fi.type = 'button';
    fi.className = 'circle-detail__files';
    fi.textContent = tr('circle.folio.title');
    fi.addEventListener('click', () => onFiles());
    bar.appendChild(fi);
  }
  if (typeof onRules === 'function' && showRules) {
    const ru = document.createElement('button');
    ru.type = 'button';
    ru.className = 'circle-detail__rules';
    ru.textContent = tr('circle.rules.title');
    ru.addEventListener('click', () => onRules());
    bar.appendChild(ru);
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

  // 5.9d — Proof-of-Location placeholder row. Passive status, not tappable.
  // Renders "Not configured" until a future slice wires a real attestation
  // reader via the `getPolStatus` skill seam.
  const polRow = document.createElement('div');
  polRow.className = 'circle-detail__pol';
  const polLabel = document.createElement('span');
  polLabel.className = 'circle-detail__pol-label';
  polLabel.textContent = tr('circle.pol.title');
  const polValue = document.createElement('span');
  polValue.className = 'circle-detail__pol-value';
  polValue.textContent = formatPolStatus(pol, tr);
  polRow.appendChild(polLabel);
  polRow.appendChild(document.createTextNode(' '));
  polRow.appendChild(polValue);
  container.appendChild(polRow);

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
