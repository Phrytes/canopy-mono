/**
 * canopy-chat v2 — circle launcher (web DOM renderer, board 1B).
 *
 * Pure render over a circle list; the host injects data + handlers +
 * `t`. Mirrors the `renderSidebar(container, ctx)` pattern. No data
 * fetching, no agent — that lives in the host boot (`circleApp.js`), so
 * this stays unit-testable under happy-dom.
 */

export function renderCircleLauncher(container, {
  circles = [],
  t,
  onOpenCircle,
  onNewCircle,
  onAvailability,
  onStream,
  onHop,
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
    avatar.textContent = circleInitial(c.name);
    tile.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'circle-tile__body';
    const name = document.createElement('div');
    name.className = 'circle-tile__name';
    name.textContent = c.name;
    body.appendChild(name);

    if (c.memberCount != null) {
      const meta = document.createElement('div');
      meta.className = 'circle-tile__meta';
      meta.textContent = tr('circle.members', { count: c.memberCount });
      body.appendChild(meta);
    }
    tile.appendChild(body);

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
