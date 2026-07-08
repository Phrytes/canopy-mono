/**
 * canopy-chat v2 — profile editor (web DOM renderer, S2 — identity + matching).
 *
 * The "Mij" surface: your handle + display name (#5), your personal skills from
 * the stoop taxonomy (#6), and your coarse location (#7). Pure render — the host
 * (`circleApp.js` showMij) loads `getMyProfile`/`listSkillCategories` and
 * dispatches the stoop mutations behind the callbacks. Personal skills here are
 * DISTINCT from `showSkills` (which is the circle's openness *policy*).
 *
 * D / SP-3b consumer-switch (second live surface) — the "Mij" (Me) screen
 * header is sourced from the manifest PAGE projection: the `me` op declares
 * `surfaces.page`, renderWeb projects it into NavModel.pages[], and the header
 * label flows `page.labelKey → t()` via the shared `pageLabel` selector — not a
 * hardcoded tr('circle.profile.title'). Pure selector lives in shared src.
 */
import { pageLabel } from '../../src/v2/pageProjection.js';

export function renderCircleProfile(container, {
  profile = {},
  categories = [],
  geocodeResult = null,
  busy = false,
  t,
  onSaveProfile,
  onAddSkill,
  onRemoveSkill,
  onGeocode,
  onSaveLocation,
  onClearLocation,
  onAvailability,
  onMyData,
  // SILENT out-of-circle delivery — open the personal, cross-circle "shared with me"
  // inbox (sealed copies peers pushed to this device). A Mij sub-screen link, peer of
  // availability/my-data. Absent ⇒ the link is simply omitted (older callers / tests).
  onSharedWithMe,
  // D / SP-3b consumer-switch — the projected PAGE surface for the `me` op
  // (renderWeb(manifest).pages[] entry, selected via pageForOp). When present,
  // the header label is derived from `page.labelKey` via t() (Q22), making this
  // a genuine runtime consumer of the manifest projection. Absent (older callers
  // / tests) ⇒ the header falls back to tr('circle.profile.title') bit-for-bit.
  profilePage = null,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-profile';

  const heading = document.createElement('h2');
  heading.className = 'cc-profile__title';
  // D / SP-3b consumer-switch — label FROM the manifest projection: the `me`
  // op's `surfaces.page.labelKey`, projected by renderWeb, resolved through t()
  // (Q22). Falls back to the raw page.title, then to the pre-existing
  // tr('circle.profile.title') when no projected page is passed.
  heading.textContent = pageLabel(profilePage, tr, tr('circle.profile.title'));
  container.appendChild(heading);

  // ── identity (handle + display name) ────────────────────────────────────
  const idSection = section(tr('circle.profile.identity'));
  const handle = labelledInput(tr('circle.profile.handle'), profile.handle ?? '', 'cc-profile__handle');
  const display = labelledInput(tr('circle.profile.displayName'), profile.displayName ?? '', 'cc-profile__display');
  idSection.appendChild(handle.wrap);
  idSection.appendChild(display.wrap);
  const save = button(tr('circle.profile.save'), 'cc-profile__save', () => {
    if (typeof onSaveProfile === 'function') onSaveProfile({ handle: handle.input.value.trim(), displayName: display.input.value.trim() });
  });
  idSection.appendChild(save);
  container.appendChild(idSection);

  // ── skills ──────────────────────────────────────────────────────────────
  const catLabel = (id) => categories.find((c) => c.id === id)?.label ?? id;
  const skillSection = section(tr('circle.profile.skills'));
  const mySkills = Array.isArray(profile.skills) ? profile.skills : [];
  if (!mySkills.length) {
    const none = document.createElement('p');
    none.className = 'cc-profile__none';
    none.textContent = tr('circle.profile.no_skills');
    skillSection.appendChild(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'cc-profile__skill-list';
    for (const sk of mySkills) {
      const li = document.createElement('li');
      li.className = 'cc-profile__skill';
      li.dataset.categoryId = sk.categoryId;
      const name = document.createElement('span');
      name.textContent = catLabel(sk.categoryId);
      li.appendChild(name);
      const rm = button('×', 'cc-profile__skill-remove', () => { if (typeof onRemoveSkill === 'function') onRemoveSkill(sk.categoryId); });
      rm.setAttribute('aria-label', tr('circle.profile.remove_skill'));
      li.appendChild(rm);
      list.appendChild(li);
    }
    skillSection.appendChild(list);
  }
  // add: category select + button
  const addRow = document.createElement('div');
  addRow.className = 'cc-profile__skill-add';
  const select = document.createElement('select');
  select.className = 'cc-profile__skill-select';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = tr('circle.profile.pick_skill');
  select.appendChild(placeholder);
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    select.appendChild(opt);
  }
  addRow.appendChild(select);
  addRow.appendChild(button(tr('circle.profile.add_skill'), 'cc-profile__skill-add-btn', () => {
    if (select.value && typeof onAddSkill === 'function') onAddSkill(select.value);
  }));
  skillSection.appendChild(addRow);
  container.appendChild(skillSection);

  // ── location ──────────────────────────────────────────────────────────────
  const locSection = section(tr('circle.profile.location'));
  const current = document.createElement('p');
  current.className = 'cc-profile__loc-current';
  current.textContent = profile.location?.label
    ? tr('circle.profile.loc_current', { label: profile.location.label })
    : tr('circle.profile.loc_none');
  locSection.appendChild(current);
  const geoRow = document.createElement('div');
  geoRow.className = 'cc-profile__geo';
  const geoInput = document.createElement('input');
  geoInput.type = 'text';
  geoInput.className = 'cc-profile__geo-input';
  geoInput.placeholder = tr('circle.profile.geo_placeholder');
  geoRow.appendChild(geoInput);
  geoRow.appendChild(button(tr('circle.profile.geo_search'), 'cc-profile__geo-search', () => {
    const q = geoInput.value.trim();
    if (q && typeof onGeocode === 'function') onGeocode(q);
  }));
  locSection.appendChild(geoRow);
  if (geocodeResult?.label) {
    const res = document.createElement('div');
    res.className = 'cc-profile__geo-result';
    const lbl = document.createElement('span');
    lbl.textContent = geocodeResult.label;
    res.appendChild(lbl);
    res.appendChild(button(tr('circle.profile.geo_use'), 'cc-profile__geo-use', () => { if (typeof onSaveLocation === 'function') onSaveLocation(); }));
    locSection.appendChild(res);
  }
  if (profile.location?.label) {
    locSection.appendChild(button(tr('circle.profile.loc_clear'), 'cc-profile__loc-clear', () => { if (typeof onClearLocation === 'function') onClearLocation(); }));
  }
  container.appendChild(locSection);

  // ── availability + my-data links ──────────────────────────────────────────
  if (typeof onAvailability === 'function') {
    const avail = button(tr('circle.profile.availability'), 'cc-profile__availability', onAvailability);
    container.appendChild(avail);
  }
  if (typeof onMyData === 'function') {
    const myData = button(tr('circle.profile.mydata'), 'cc-profile__mydata', onMyData);
    container.appendChild(myData);
  }
  if (typeof onSharedWithMe === 'function') {
    const shared = button(tr('circle.profile.sharedWithMe'), 'cc-profile__shared-with-me', onSharedWithMe);
    container.appendChild(shared);
  }

  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-profile__busy';
    b.textContent = tr('circle.profile.saving');
    container.appendChild(b);
  }
  return container;

  // ── helpers ──
  function section(titleText) {
    const s = document.createElement('section');
    s.className = 'cc-profile__section';
    const h = document.createElement('h3');
    h.className = 'cc-profile__section-title';
    h.textContent = titleText;
    s.appendChild(h);
    return s;
  }
  function labelledInput(labelText, value, cls) {
    const wrap = document.createElement('label');
    wrap.className = 'cc-profile__field';
    const span = document.createElement('span');
    span.className = 'cc-profile__field-label';
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.value = value;
    wrap.appendChild(span);
    wrap.appendChild(input);
    return { wrap, input };
  }
  function button(text, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
