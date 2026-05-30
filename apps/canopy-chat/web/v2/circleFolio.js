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
// P6.M8 #350 — share-toggle row above the filter strip.
const SHARE_FILTERS = ['shared-by-me', 'shared-with-me'];

export function renderCircleFolioBrowser(container, {
  files = [],
  t,
  onBack,
  onOpen,
  filter = 'all',
  onFilter,
  // P6.M8 — when set, toggling cycles the share filter; null = neither
  // pill is active (the normal filter strip handles the list).
  shareFilter = null,
  onShareFilter,
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

  // P6.M8 #350 — share-toggle row (Shared-by-me / Shared-with-me).  Only
  // appears when the host wires an `onShareFilter` callback.
  if (typeof onShareFilter === 'function') {
    const shareRow = document.createElement('div');
    shareRow.className = 'circle-folio__share-toggle';
    for (const key of SHARE_FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-folio__share-filter';
      btn.dataset.shareFilter = key;
      if (key === shareFilter) btn.classList.add('is-active');
      // Locale key uses underscore: shared_by_me / shared_with_me.
      btn.textContent = tr(`circle.folio.${key.replace(/-/g, '_')}`);
      // Click toggles: re-clicking an active pill clears it.
      btn.addEventListener('click', () => {
        onShareFilter(shareFilter === key ? null : key);
      });
      shareRow.appendChild(btn);
    }
    container.appendChild(shareRow);
  }

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
    // P6.M8 — share-filter-specific empty copy when one is active.
    const emptyKey = shareFilter === 'shared-by-me'
      ? 'circle.folio.shared_by_me_empty'
      : shareFilter === 'shared-with-me'
        ? 'circle.folio.shared_with_me_empty'
        : 'circle.folio.empty';
    empty.textContent = tr(emptyKey);
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
