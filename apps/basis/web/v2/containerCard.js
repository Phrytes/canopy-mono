/**
 * renderContainerCard — render a `projectContainer` tree as a nested DOM card (cluster K · K2, container UI).
 *
 * The composable model made visible: a container (a list / offer) shows its CONTAINED children nested, each
 * via its type's render shape (label + row-action buttons), arbitrarily deep (offer→list→tasks→sub-tasks). A
 * node that accepts children (`node.canAdd`) gets a "+ add" affordance → the shell's `onAdd` (which resolves
 * the child type + creates it, `resolveAddInContainer`→`addChildTo`). Row-action buttons → `onRowAction`.
 *
 * Pure VIEW: the shell passes the tree (from `projectContainer`, with `canAdd`/`rowActions` filled from the
 * `accepts` policy + each type's render) + the tap handlers. web≡mobile: mobile mirrors this off the same tree.
 *
 * @param {object} tree  a projectContainer node: `{ id, type, label, children, canAdd?, rowActions? }`
 * @param {object} [handlers]
 * @param {(node:object)=>void} [handlers.onAdd]         tap "+ add" on a container node
 * @param {(op:string, node:object)=>void} [handlers.onRowAction]  tap a row-action button
 * @param {(key:string, params?:object, fallback?:string)=>string} [handlers.t]  translator (add/row labels)
 * @returns {HTMLElement}
 */
export function renderContainerCard(tree, handlers = {}) {
  const card = document.createElement('div');
  card.className = 'circle-container-card';
  if (tree && tree.id) card.dataset.itemId = tree.id;
  if (tree) renderNode(card, tree, 0, handlers);
  return card;
}

function label(handlers, key, fallback) {
  return typeof handlers.t === 'function' ? handlers.t(key, undefined, fallback) || fallback : fallback;
}

function renderNode(parentEl, node, depth, handlers) {
  const row = document.createElement('div');
  row.className = 'circle-container-card__row';
  row.style.marginLeft = `${depth * 16}px`;
  row.dataset.itemId = node.id;
  row.dataset.type = node.type;
  row.dataset.depth = String(depth);

  const lbl = document.createElement('span');
  lbl.className = 'circle-container-card__label';
  lbl.textContent = node.label ?? node.text ?? node.id ?? '';
  row.appendChild(lbl);

  for (const op of (Array.isArray(node.rowActions) ? node.rowActions : [])) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-container-card__action';
    btn.dataset.op = op;
    btn.textContent = label(handlers, `circle.container.action.${op}`, op);
    btn.addEventListener('click', () => { if (typeof handlers.onRowAction === 'function') handlers.onRowAction(op, node); });
    row.appendChild(btn);
  }

  if (node.canAdd) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'circle-container-card__add';
    addBtn.dataset.addTo = node.id;
    addBtn.textContent = label(handlers, 'circle.container.add', '+ add');
    addBtn.addEventListener('click', () => { if (typeof handlers.onAdd === 'function') handlers.onAdd(node); });
    row.appendChild(addBtn);
  }

  parentEl.appendChild(row);

  for (const child of (Array.isArray(node.children) ? node.children : [])) {
    renderNode(parentEl, child, depth + 1, handlers);
  }
}
