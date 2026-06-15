/**
 * canopy-chat v2 — circle admin panel (web DOM renderer, S3 — group ops #8).
 *
 * The per-circle admin surface off the `⋯` menu: the member roster (with role +
 * a remove action) and a post-announcement box. Pure render — the host
 * (`circleApp.js` showAdmin) loads `listGroupMembers` and dispatches the
 * admin-gated stoop ops (`removeMember`, `postAnnouncement`); a non-admin's
 * dispatch is refused server-side, surfaced as a notice.
 */

export function renderCircleAdminPanel(container, {
  members = [],
  busy = false,
  notice = null,
  t,
  onRemove,
  onAnnounce,
  onBack,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-admin';

  const header = document.createElement('div');
  header.className = 'cc-admin__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-admin__back';
    back.textContent = tr('circle.admin.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-admin__title';
  title.textContent = tr('circle.admin.title');
  header.appendChild(title);
  container.appendChild(header);

  if (notice) {
    const n = document.createElement('div');
    n.className = 'cc-admin__notice';
    n.textContent = notice;
    container.appendChild(n);
  }

  // ── members ───────────────────────────────────────────────────────────────
  const memSection = document.createElement('section');
  memSection.className = 'cc-admin__section';
  const memTitle = document.createElement('h3');
  memTitle.className = 'cc-admin__section-title';
  memTitle.textContent = tr('circle.admin.members');
  memSection.appendChild(memTitle);

  if (!members.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-admin__empty';
    empty.textContent = tr('circle.admin.no_members');
    memSection.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'cc-admin__member-list';
    for (const m of members) {
      const li = document.createElement('li');
      li.className = 'cc-admin__member';
      li.dataset.webid = m.webid ?? '';
      const name = document.createElement('span');
      name.className = 'cc-admin__member-name';
      name.textContent = m.displayName || m.handle || m.webid || '';
      li.appendChild(name);
      if (m.role && m.role !== 'member') {
        const role = document.createElement('span');
        role.className = 'cc-admin__member-role';
        role.textContent = tr(`circle.admin.role.${m.role}`);
        li.appendChild(role);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-admin__member-remove';
      rm.textContent = tr('circle.admin.remove');
      rm.addEventListener('click', () => { if (typeof onRemove === 'function') onRemove(m); });
      li.appendChild(rm);
      list.appendChild(li);
    }
    memSection.appendChild(list);
  }
  container.appendChild(memSection);

  // ── announcement ────────────────────────────────────────────────────────
  const annSection = document.createElement('section');
  annSection.className = 'cc-admin__section';
  const annTitle = document.createElement('h3');
  annTitle.className = 'cc-admin__section-title';
  annTitle.textContent = tr('circle.admin.announce');
  annSection.appendChild(annTitle);
  const form = document.createElement('form');
  form.className = 'cc-admin__announce';
  const area = document.createElement('textarea');
  area.className = 'cc-admin__announce-input';
  area.rows = 2;
  area.placeholder = tr('circle.admin.announce_placeholder');
  form.appendChild(area);
  const post = document.createElement('button');
  post.type = 'submit';
  post.className = 'cc-admin__announce-post';
  post.textContent = tr('circle.admin.announce_post');
  form.appendChild(post);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text) return;
    area.value = '';
    if (typeof onAnnounce === 'function') onAnnounce(text);
  });
  annSection.appendChild(form);
  container.appendChild(annSection);

  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-admin__busy';
    b.textContent = tr('circle.admin.saving');
    container.appendChild(b);
  }
  return container;
}
