/**
 * canopy-chat v2 — circle-scoped Folio file browser (web DOM renderer,
 * board 10B).
 *
 * A drive-like view onto a circle's shared pod: a filter strip (All /
 * Favourites / Recent) over `buildCircleFiles` rows, each row carrying a
 * file name.  Pure render: the host passes rows + handlers + `t`; tapping
 * a row opens that file (onOpen).  Mirrors the stream renderer so it
 * stays unit-testable under happy-dom.
 */

const FILTERS = ['all', 'favourites', 'recent'];

export function renderCircleFolioBrowser(container, {
  files = [],
  t,
  onBack,
  onOpen,
  filter = 'all',
  onFilter,
  loading = false,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-folio');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-folio__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-folio__title';
  head.textContent = tr('circle.folio.title');
  container.appendChild(head);

  const strip = document.createElement('div');
  strip.className = 'circle-folio__filters';
  for (const key of FILTERS) {
    const fb = document.createElement('button');
    fb.type = 'button';
    fb.className = 'circle-folio__filter';
    fb.dataset.filter = key;
    if (key === filter) fb.classList.add('is-active');
    fb.textContent = tr(`circle.folio.${key}`);
    fb.addEventListener('click', () => { if (typeof onFilter === 'function') onFilter(key); });
    strip.appendChild(fb);
  }
  container.appendChild(strip);

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-folio__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-folio__empty';
    empty.textContent = tr('circle.folio.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-folio__list';
  for (const file of files) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'circle-folio__row';
    el.dataset.fileId = file.id;

    const name = document.createElement('span');
    name.className = 'circle-folio__name';
    name.textContent = file.name;
    el.appendChild(name);

    el.addEventListener('click', () => {
      if (typeof onOpen === 'function') onOpen(file);
    });
    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}
