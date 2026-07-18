/**
 * basis v2 — cross-circle Stream (web DOM renderer).
 *
 * One timeline over `buildCircleStream` rows (newest-first), each row
 * carrying a circle-tag chip + `app · type` + a timestamp.  Pure render:
 * the host passes rows + handlers + `t`.  Tapping a circle-tagged row
 * jumps to that circle (onOpenCircle); un-tagged rows are inert.  Mirrors
 * the launcher renderer so it stays unit-testable under happy-dom.
 */

export function renderCircleStream(container, {
  rows = [],
  t,
  onBack,
  onOpenCircle,
  loading = false,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-stream');

  // Back link only when a handler is supplied — top-level tab screens
  // (reached via the bottom bar) omit it; sub-screens keep it.
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'circle-stream__back';
    back.textContent = tr('circle.back');
    back.addEventListener('click', () => onBack());
    container.appendChild(back);
  }

  const head = document.createElement('h2');
  head.className = 'circle-stream__title';
  head.textContent = tr('circle.stream.title');
  container.appendChild(head);

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-stream__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-stream__empty';
    empty.textContent = tr('circle.stream.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-stream__list';
  for (const row of rows) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'circle-stream__row';
    el.dataset.eventId = row.id;
    if (row.circleId) el.dataset.circleId = row.circleId;

    const tag = document.createElement('span');
    tag.className = 'circle-stream__tag';
    tag.textContent = row.circleName || tr('circle.stream.untagged');
    el.appendChild(tag);

    const body = document.createElement('span');
    body.className = 'circle-stream__body';
    body.textContent = [row.app, row.type].filter(Boolean).join(' · ');
    el.appendChild(body);

    const when = document.createElement('span');
    when.className = 'circle-stream__when';
    when.textContent = formatTs(row.ts);
    el.appendChild(when);

    if (row.circleId) {
      el.addEventListener('click', () => {
        if (typeof onOpenCircle === 'function') onOpenCircle(row.circleId);
      });
    } else {
      el.disabled = true;
    }
    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}

function formatTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}
