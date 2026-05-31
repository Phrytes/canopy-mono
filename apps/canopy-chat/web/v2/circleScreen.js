/**
 * canopy-chat v2 — screen renderer (Plan α.1c.1 · audit gap #1).
 *
 * Consumes materialized blocks from `kringRecipeBlocks.js` and produces
 * the DOM for scherm-mode (v2 §4 pill, §2 RECEPT · SCHERM-WEERGAVE
 * INRICHTEN).
 *
 * Pure DOM render (web).  Mobile parity ships as α.1e using the same
 * materialized-block input.
 *
 * Per-block-type render:
 *   announcement → serif headline card (pinned admin message)
 *   text         → plain-text paragraph card
 *   photo        → image with optional caption
 *   noticeboard  → list of recent posts (sender · text)
 *   agenda       → list of upcoming events (label · state)
 *   rules        → rendered governance doc (per-field section)
 *
 * Each block also surfaces its status:
 *   ok      → normal render
 *   empty   → muted placeholder ("nothing here yet")
 *   error   → red border + error message (per-block, page keeps rendering)
 */

/**
 * Render an array of materialized blocks into a container.
 *
 * @param {HTMLElement} container
 * @param {object}   args
 * @param {object[]} args.blocks   materializeRecipe(...) output
 * @param {Function} args.t        localizer
 * @returns {HTMLElement}
 */
export function renderCircleScreen(container, { blocks = [], t } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-screen');

  if (!Array.isArray(blocks) || blocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'circle-screen__empty';
    empty.textContent = tr('circle.screen.empty');
    container.appendChild(empty);
    return container;
  }

  for (const block of blocks) {
    container.appendChild(renderBlock(block, { tr }));
  }
  return container;
}

/* ─────────────────────────────────────────────────────────────────────── */

// α.5c — list-shaped block types that honour the optional
// `config.compact` flag (tighter rows + smaller text on the screen).
const COMPACTABLE_TYPES = new Set(['announcement', 'noticeboard', 'agenda', 'tasks']);

function renderBlock(block, { tr }) {
  const section = document.createElement('section');
  section.className = `circle-screen__block circle-screen__block--${block.type}`;
  if (COMPACTABLE_TYPES.has(block.type) && block.config?.compact === true) {
    section.classList.add('circle-screen__block--compact');
  }
  section.dataset.blockId = block.blockId ?? '';
  section.dataset.blockType = block.type;
  section.dataset.status = block.status;

  if (block.status === 'error') {
    section.classList.add('circle-screen__block--error');
    section.textContent = tr('circle.screen.block_error', { type: block.type })
      + (block.error ? ` — ${block.error}` : '');
    return section;
  }
  if (block.status === 'empty') {
    section.classList.add('circle-screen__block--empty');
    section.textContent = tr('circle.screen.block_empty', { type: block.type });
    return section;
  }

  switch (block.type) {
    case 'announcement': renderAnnouncement(section, block, tr); break;
    case 'text':         renderText(section, block, tr);         break;
    case 'photo':        renderPhoto(section, block, tr);        break;
    case 'noticeboard':  renderNoticeboard(section, block, tr);  break;
    case 'agenda':       renderAgenda(section, block, tr);       break;
    case 'tasks':        renderTasks(section, block, tr);        break;
    case 'rules':        renderRules(section, block, tr);        break;
    default:
      section.textContent = tr('circle.screen.block_unknown', { type: block.type });
  }
  return section;
}

function renderAnnouncement(section, block, _tr) {
  const body = document.createElement('p');
  body.className = 'circle-screen__announcement-text';
  body.textContent = block.content?.text ?? '';
  section.appendChild(body);
}

function renderText(section, block, _tr) {
  const body = document.createElement('p');
  body.className = 'circle-screen__text-body';
  body.textContent = block.content?.text ?? '';
  section.appendChild(body);
}

function renderPhoto(section, block, _tr) {
  const img = document.createElement('img');
  img.className = 'circle-screen__photo';
  img.src = block.content?.src ?? '';
  img.alt = block.content?.caption ?? '';
  section.appendChild(img);
  const caption = (block.content?.caption ?? '').trim();
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'circle-screen__photo-caption';
    cap.textContent = caption;
    section.appendChild(cap);
  }
}

function renderNoticeboard(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.noticeboard');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__noticeboard-list';
  for (const row of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__noticeboard-row';
    li.dataset.rowId = row.id ?? '';
    const sender = pickSender(row);
    if (sender) {
      const s = document.createElement('span');
      s.className = 'circle-screen__noticeboard-sender';
      s.textContent = sender;
      li.appendChild(s);
    }
    const text = document.createElement('span');
    text.className = 'circle-screen__noticeboard-text';
    text.textContent = pickRowText(row);
    li.appendChild(text);
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderAgenda(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.agenda');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__agenda-list';
  for (const ev of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__agenda-row';
    li.dataset.eventId = ev.id ?? '';
    const lbl = document.createElement('span');
    lbl.className = 'circle-screen__agenda-label';
    lbl.textContent = ev.label ?? '';
    li.appendChild(lbl);
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderTasks(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.tasks');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__tasks-list';
  for (const task of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__tasks-row';
    li.dataset.taskId = task.id ?? '';
    li.dataset.state = task.state ?? '';
    if (task.circleName) {
      const tag = document.createElement('span');
      tag.className = 'circle-screen__tasks-circle';
      tag.textContent = task.circleName;
      li.appendChild(tag);
    }
    const text = document.createElement('span');
    text.className = 'circle-screen__tasks-text';
    text.textContent = task.text ?? '';
    li.appendChild(text);
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderRules(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.rules');
  section.appendChild(title);

  const doc = block.content?.doc ?? {};
  for (const field of ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility']) {
    const value = (doc[field] ?? '').trim();
    if (!value) continue;
    const dl = document.createElement('div');
    dl.className = `circle-screen__rules-field circle-screen__rules-field--${field}`;
    const dt = document.createElement('div');
    dt.className = 'circle-screen__rules-label';
    dt.textContent = tr(`circle.rules.field.${field}`);
    const dd = document.createElement('div');
    dd.className = 'circle-screen__rules-value';
    dd.textContent = value;
    dl.appendChild(dt); dl.appendChild(dd);
    section.appendChild(dl);
  }
}

/* ─────────────────────────────────────────────────────────────────────── */

function pickSender(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['senderDisplay', 'authorName', 'displayName', 'actor']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  if (typeof row?.actor === 'string' && row.actor) return row.actor;
  return null;
}

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return '';
}
