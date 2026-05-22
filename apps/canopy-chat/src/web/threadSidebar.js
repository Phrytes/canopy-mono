/**
 * **Platform: web** (DOM-dependent).  Needs an RN sibling under `rn/` — see
 * `Project Files/canopy-chat/coding-plan.md` § RN portability inventory.
 *
 * canopy-chat — thread sidebar DOM adapter.
 *
 * Renders the workspace's threads as a clickable list + new-thread
 * form.  Pure DOM (no framework); subscribes to ThreadStore changes
 * for live updates.
 *
 * Phase v0.2 sub-slice 2.3 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { describeFilter } from '../filter.js';

/**
 * @typedef {object} SidebarContext
 * @property {Document}                                  doc
 * @property {import('../threadStore.js').ThreadStore}   store
 * @property {(threadId: string) => void}                onSelect
 *   Called when the user clicks a thread (request to set active).
 * @property {(t: string) => string}                     [t]
 *   Optional localisation function.
 */

/**
 * Re-render the sidebar's thread list inside `container`.  Idempotent;
 * re-call on every ThreadStore change.
 *
 * @param {Element}         container
 * @param {SidebarContext}  ctx
 */
export function renderSidebar(container, ctx) {
  if (!container) throw new TypeError('renderSidebar: container required');
  const { doc, store, onSelect, t } = ctx;
  const tr = typeof t === 'function' ? t : (k) => k;

  while (container.firstChild) container.removeChild(container.firstChild);

  // Heading
  const heading = doc.createElement('h2');
  heading.className = 'cc-sidebar-heading';
  heading.textContent = tr('sidebar.heading');
  container.appendChild(heading);

  // + New thread button
  const newBtn = doc.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'cc-sidebar-new-thread';
  newBtn.textContent = tr('sidebar.new_thread');
  newBtn.addEventListener('click', () => toggleNewForm(container, ctx));
  container.appendChild(newBtn);

  // (form mounts under the button when toggled)
  const formMount = doc.createElement('div');
  formMount.className = 'cc-sidebar-form-mount';
  container.appendChild(formMount);

  // Thread list
  const ul = doc.createElement('ul');
  ul.className = 'cc-thread-list';
  for (const thread of store.listThreads()) {
    ul.appendChild(renderThreadRow(thread, ctx));
  }
  container.appendChild(ul);
}

function renderThreadRow(thread, { doc, store, onSelect, t }) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const li = doc.createElement('li');
  const isActive = thread.id === store.activeId;
  li.className = `cc-thread-row${isActive ? ' cc-thread-active' : ''}`;
  li.dataset.threadId = thread.id;

  const nameBtn = doc.createElement('button');
  nameBtn.type = 'button';
  nameBtn.className = 'cc-thread-name';
  nameBtn.textContent = thread.name;
  nameBtn.addEventListener('click', () => onSelect(thread.id));
  li.appendChild(nameBtn);

  const filterLabel = doc.createElement('span');
  filterLabel.className = 'cc-thread-filter';
  filterLabel.textContent = describeFilter(thread.filter);
  li.appendChild(filterLabel);

  // Delete button — disabled for the last remaining thread (UX guard).
  const delBtn = doc.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cc-thread-delete';
  delBtn.textContent = '×';
  delBtn.title = tr('sidebar.delete');
  delBtn.disabled = store.size <= 1;
  delBtn.addEventListener('click', () => {
    if (store.size <= 1) return;
    store.deleteThread(thread.id);
  });
  li.appendChild(delBtn);

  return li;
}

function toggleNewForm(container, ctx) {
  const mount = container.querySelector('.cc-sidebar-form-mount');
  if (!mount) return;
  if (mount.firstChild) {
    // close
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    return;
  }
  mount.appendChild(renderNewThreadForm(ctx, () => {
    while (mount.firstChild) mount.removeChild(mount.firstChild);
  }));
}

function renderNewThreadForm({ doc, store, onSelect, t }, onDone) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const form = doc.createElement('form');
  form.className = 'cc-new-thread-form';

  // Name
  const nameLabel = doc.createElement('label');
  nameLabel.textContent = tr('sidebar.form_name');
  const nameInput = doc.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.className = 'cc-form-name';
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  // Apps filter (comma-separated)
  const appsLabel = doc.createElement('label');
  appsLabel.textContent = tr('sidebar.form_apps');
  const appsInput = doc.createElement('input');
  appsInput.type = 'text';
  appsInput.placeholder = '*  or  household,tasks-v0';
  appsInput.className = 'cc-form-apps';
  appsLabel.appendChild(appsInput);
  form.appendChild(appsLabel);

  // Event types filter (comma-separated)
  const typesLabel = doc.createElement('label');
  typesLabel.textContent = tr('sidebar.form_event_types');
  const typesInput = doc.createElement('input');
  typesInput.type = 'text';
  typesInput.placeholder = 'notification,reminder';
  typesInput.className = 'cc-form-types';
  typesLabel.appendChild(typesInput);
  form.appendChild(typesLabel);

  // allowCommands toggle
  const cmdLabel = doc.createElement('label');
  cmdLabel.className = 'cc-form-checkbox';
  const cmdInput = doc.createElement('input');
  cmdInput.type = 'checkbox';
  cmdInput.checked = true;
  cmdLabel.appendChild(cmdInput);
  cmdLabel.appendChild(doc.createTextNode(' ' + tr('sidebar.form_allow_commands')));
  form.appendChild(cmdLabel);

  // Buttons
  const actions = doc.createElement('div');
  actions.className = 'cc-form-actions';
  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.textContent = tr('sidebar.form_create');
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = tr('sidebar.form_cancel');
  cancel.addEventListener('click', () => onDone());
  actions.appendChild(submit);
  actions.appendChild(cancel);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const apps  = parseList(appsInput.value);
    const types = parseList(typesInput.value);
    const t = store.createThread({
      name,
      filter:      {
        ...(apps.length  > 0 ? { apps  } : {}),
        ...(types.length > 0 ? { eventTypes: types } : {}),
      },
      permissions: { allowCommands: cmdInput.checked },
    });
    onSelect(t.id);
    onDone();
  });

  return form;
}

function parseList(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
