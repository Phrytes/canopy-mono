/**
 * basis v2 — Nearby / HIER screen (web DOM renderer, board 8C).
 *
 * Renders the model `buildNearbyModel` produces: header line, per-peer
 * rows (pseudonym + shared-skills + proximity), and an own-profile
 * footer showing what others see of *me*.  Pure render — host wires
 * the model + `t` + back handler.
 *
 * Web is mDNS-blind today (the substrate runs but `peers=[]`), so the
 * empty state will be the common path until P6.8-followup #346 brings
 * a mDNS broadcast on web.  The screen still renders honestly: empty
 * list + the user's own published-skill footer so they understand
 * what others would see if they showed up.
 */

export function renderCircleNearby(container, {
  model = null,
  t,
  onBack,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-nearby');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-nearby__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-nearby__title';
  head.textContent = tr('circle.nearbyScreen.title');
  container.appendChild(head);

  const safeModel = model && typeof model === 'object' ? model : { rows: [], counts: { total: 0, sharingAny: 0 }, ownProfile: {}, headerLabel: '' };
  const { rows = [], ownProfile = {}, headerLabel = '' } = safeModel;

  const header = document.createElement('div');
  header.className = 'circle-nearby__header';
  header.textContent = headerLabel;
  container.appendChild(header);

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-nearby__empty';
    empty.textContent = tr('circle.nearbyScreen.header_empty');
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'circle-nearby__list';
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'circle-nearby__row';
      if (row.sharesAny) el.classList.add('is-sharing');
      el.dataset.peerId = row.id || '';

      const name = document.createElement('div');
      name.className = 'circle-nearby__name';
      name.textContent = row.pseudonym;
      el.appendChild(name);

      if (row.sharedSkills.length) {
        const skills = document.createElement('div');
        skills.className = 'circle-nearby__skills';
        skills.textContent = row.sharedSkills.join(', ');
        el.appendChild(skills);
      }

      if (row.proximity) {
        const prox = document.createElement('div');
        prox.className = 'circle-nearby__proximity';
        prox.textContent = row.proximity;
        el.appendChild(prox);
      }

      list.appendChild(el);
    }
    container.appendChild(list);
  }

  const footer = document.createElement('div');
  footer.className = 'circle-nearby__own';
  const ownTitle = document.createElement('div');
  ownTitle.className = 'circle-nearby__own-title';
  ownTitle.textContent = tr('circle.nearbyScreen.own_profile');
  footer.appendChild(ownTitle);
  const ownSkills = document.createElement('div');
  ownSkills.className = 'circle-nearby__own-skills';
  const skills = Array.isArray(ownProfile.publishedSkills) ? ownProfile.publishedSkills : [];
  ownSkills.textContent = skills.length
    ? skills.join(', ')
    : tr('circle.nearbyScreen.own_profile_empty');
  footer.appendChild(ownSkills);
  container.appendChild(footer);

  return container;
}
