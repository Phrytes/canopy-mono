/**
 * listScreen — B · Slice 3 web renderer for a manifest `surfaces.screen` list surface.
 *
 * Controlled DOM render over a screen MODEL (`buildScreenModel`): a search box, category checkboxes,
 * and the filtered rows each with their capability-gated action buttons (greyed/hidden per Slice 4).
 * The host owns the query/activeCategories state, rebuilds the model, and re-renders. Pure DOM →
 * unit-testable under happy-dom. Row actions + the filter/category events fire callbacks; nothing here
 * dispatches or fetches.
 */

export function renderListScreen(container, {
  model, t, title, query = '',
  onQuery, onToggleCategory, onRowAction,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('list-screen');

  if (title) {
    const h = document.createElement('h2');
    h.className = 'list-screen__title';
    h.textContent = title;
    container.appendChild(h);
  }

  // Search box — the "contacten met k" filter.
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'list-screen__search';
  search.placeholder = tr('circle.screen.filter_placeholder');
  search.value = query;
  search.addEventListener('input', () => { if (typeof onQuery === 'function') onQuery(search.value); });
  container.appendChild(search);

  // Category checkboxes.
  const cats = Array.isArray(model?.categories) ? model.categories : [];
  if (cats.length) {
    const catBar = document.createElement('div');
    catBar.className = 'list-screen__categories';
    for (const c of cats) {
      const label = document.createElement('label');
      label.className = 'list-screen__category';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!c.checked;
      box.dataset.category = c.id;
      box.addEventListener('change', () => { if (typeof onToggleCategory === 'function') onToggleCategory(c.id, box.checked); });
      const span = document.createElement('span');
      span.textContent = `${c.id} (${c.count})`;
      label.append(box, span);
      catBar.appendChild(label);
    }
    container.appendChild(catBar);
  }

  // Rows.
  const listEl = document.createElement('ul');
  listEl.className = 'list-screen__rows';
  const rows = Array.isArray(model?.rows) ? model.rows : [];
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'list-screen__empty';
    empty.textContent = tr('circle.screen.empty');
    listEl.appendChild(empty);
  }
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'list-screen__row';
    li.dataset.itemId = row.item?.id ?? '';

    const labelEl = document.createElement('span');
    labelEl.className = 'list-screen__row-label';
    labelEl.textContent = row.label;
    li.appendChild(labelEl);

    for (const a of (row.actions || [])) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-screen__row-action';
      btn.textContent = a.label;
      btn.dataset.opId = a.opId;
      btn.dataset.itemId = a.itemId;
      if (a.disabled) { btn.disabled = true; btn.classList.add('list-screen__row-action--greyed'); }
      btn.addEventListener('click', () => { if (!a.disabled && typeof onRowAction === 'function') onRowAction({ opId: a.opId, itemId: a.itemId }); });
      li.appendChild(btn);
    }
    listEl.appendChild(li);
  }
  container.appendChild(listEl);

  return container;
}
