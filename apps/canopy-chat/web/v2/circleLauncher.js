/**
 * canopy-chat v2 — circle launcher (web DOM renderer, board 1B).
 *
 * Pure render over a circle list; the host injects data + handlers +
 * `t`. Mirrors the `renderSidebar(container, ctx)` pattern. No data
 * fetching, no agent — that lives in the host boot (`circleApp.js`), so
 * this stays unit-testable under happy-dom.
 */

import { circleTint } from '../../src/v2/theme.js';

export function renderCircleLauncher(container, {
  circles = [],
  // P6.3 — per-circle preview map ({subtitle, ts, unread}); host computes
  // via `buildTilePreviews` over the EventLog.  Null/absent → tiles show
  // the member-count fallback (current behaviour).
  previews = null,
  // P6.2 #341-followup — per-circle pending proposal counts keyed by id.
  // Host computes via `pendingApprovers` for circles with admin-approval
  // axes.  Tiles show a yellow voorstellen badge when > 0.
  proposals = null,
  t,
  onOpenCircle,
  onNewCircle,
  onAvailability,
  onStream,
  onHop,
  onNearby,
  onMyThings,
  loading = false,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-launcher');

  const heading = document.createElement('h2');
  heading.className = 'circle-launcher__title';
  heading.textContent = tr('circle.title');
  container.appendChild(heading);

  if (typeof onStream === 'function') {
    const stream = document.createElement('button');
    stream.type = 'button';
    stream.className = 'circle-launcher__stream';
    stream.textContent = tr('circle.stream.open');
    stream.addEventListener('click', () => onStream());
    container.appendChild(stream);
  }

  if (typeof onAvailability === 'function') {
    const avail = document.createElement('button');
    avail.type = 'button';
    avail.className = 'circle-launcher__availability';
    avail.textContent = tr('circle.availability.title');
    avail.addEventListener('click', () => onAvailability());
    container.appendChild(avail);
  }

  if (typeof onHop === 'function') {
    const hop = document.createElement('button');
    hop.type = 'button';
    hop.className = 'circle-launcher__hop';
    hop.textContent = tr('circle.hop.title');
    hop.addEventListener('click', () => onHop());
    container.appendChild(hop);
  }

  if (typeof onNearby === 'function') {
    const nearby = document.createElement('button');
    nearby.type = 'button';
    nearby.className = 'circle-launcher__nearby';
    nearby.textContent = tr('circle.nearbyScreen.title');
    nearby.addEventListener('click', () => onNearby());
    container.appendChild(nearby);
  }

  if (typeof onMyThings === 'function') {
    const mine = document.createElement('button');
    mine.type = 'button';
    mine.className = 'circle-launcher__my-things';
    mine.textContent = tr('circle.folio.my_things_title');
    mine.addEventListener('click', () => onMyThings());
    container.appendChild(mine);
  }

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-launcher__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!circles.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-launcher__empty';
    empty.textContent = tr('circle.empty');
    container.appendChild(empty);
  }

  const list = document.createElement('div');
  list.className = 'circle-launcher__list';
  for (const c of circles) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'circle-tile';
    tile.dataset.circleId = c.id;
    if (c.kind) tile.dataset.kind = c.kind;

    const avatar = document.createElement('div');
    avatar.className = 'circle-tile__avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.style.background = circleTint(c.id);
    avatar.textContent = circleInitial(c.name);
    tile.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'circle-tile__body';
    const name = document.createElement('div');
    name.className = 'circle-tile__name';
    name.textContent = c.name;
    body.appendChild(name);

    // P6.3 — activity subtitle replaces the member-count line when a
    // recent event carries renderable text (board 5A).  Falls back to
    // member-count when the preview map has no subtitle for this id.
    const preview = previews ? previews[c.id] : null;
    if (preview && typeof preview.subtitle === 'string' && preview.subtitle) {
      const meta = document.createElement('div');
      meta.className = 'circle-tile__meta';
      meta.textContent = preview.subtitle;
      body.appendChild(meta);
    } else if (c.memberCount != null) {
      const meta = document.createElement('div');
      meta.className = 'circle-tile__meta';
      meta.textContent = tr('circle.members', { count: c.memberCount });
      body.appendChild(meta);
    }
    tile.appendChild(body);

    // P6.3 — unread badge (red circle with the count).  Surfaces only
    // when the preview has unread > 0.
    if (preview && preview.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'circle-tile__unread';
      badge.setAttribute('aria-label', tr('circle.tile_unread', { count: preview.unread }));
      badge.textContent = String(preview.unread);
      tile.appendChild(badge);
    }

    // P6.2 #341 — pending-voorstellen badge (yellow) when this circle
    // has admin-approval proposals waiting on me.
    const pending = proposals && Number(proposals[c.id]) > 0 ? Number(proposals[c.id]) : 0;
    if (pending > 0) {
      const vb = document.createElement('span');
      vb.className = 'circle-tile__proposals';
      vb.setAttribute('aria-label', tr('circle.tile_proposals', { count: pending }));
      vb.textContent = String(pending);
      tile.appendChild(vb);
    }

    tile.addEventListener('click', () => {
      if (typeof onOpenCircle === 'function') onOpenCircle(c.id, c);
    });
    list.appendChild(tile);
  }
  container.appendChild(list);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'circle-launcher__new';
  newBtn.textContent = tr('circle.new');
  newBtn.addEventListener('click', () => {
    if (typeof onNewCircle === 'function') onNewCircle();
  });
  container.appendChild(newBtn);

  return container;
}

/** First letter of a circle name for the avatar tile (board 1). */
function circleInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : '·';
}
