/**
 * basis v2 — the ENTRUST (toevertrouwen) picker: the web surface for a
 * task-scoped MANDATE.
 *
 * A mandate is bounded authority the task owner entrusts to one member for one
 * task. It is TEMPORARY (it lifts the moment the task closes — revoke-on-complete
 * is already wired) and BROKERED (your keys stay with you; only answers travel).
 * The "toegang"/access framing is retired: this is authority you lend, not a door
 * you open.
 *
 * Thin DOM projection (a web idiom, so it lives in the web shell, not shared
 * `src/`). It calls the ALREADY-registered `attachTaskGrant` op via the host's
 * dispatch path — no grant/attenuation logic lives here. The one shared decision
 * is `buildMandateGrant`, kept pure + exported so both the picker and its test
 * build the identical grant object.
 *
 * WAARVOOR (the WHAT) is a DATA-DRIVEN grant-KIND taxonomy (not offerings-only),
 * so new kinds slot in with one entry. v1 kinds:
 *   - actAs    — "namens jou handelen": act on your behalf, unnarrowed.
 *   - offering — one of YOUR offerings (only offerings you hold appear → visible
 *                attenuation).
 *   - resource — "toegang tot een bron / iets voor je opvragen", brokered through
 *                your device. HONEST STATE: basis surfaces no grantable-resource
 *                enumeration yet AND the brokered in-circle fetch isn't wired
 *                end-to-end, so this ships as a first-class taxonomy entry marked
 *                "nog niet actief" — it does not issue. `buildMandateGrant` fully
 *                supports the kind (pure + tested); flip its spec `active` on when
 *                the enumeration + fetch land.
 */

/**
 * Build the grant object dispatched with `attachTaskGrant`. Pure. Switches on the
 * grant KIND so adding a kind is one `case` + one taxonomy entry (below).
 *
 * @param {object} o
 * @param {'actAs'|'offering'|'resource'} [o.kind]  the grant kind (inferred from
 *   the other args when omitted: offeringKey → offering, scope → resource, else actAs)
 * @param {string} o.myWebid       the granter (acts as this identity — "namens jou")
 * @param {string} [o.offeringKey] narrow the mandate to one of MY offerings (its key)
 * @param {string} [o.scope]       the resource scope/path the brokered grant targets
 * @returns {object} a TaskGrant template ({ actingAs?, skill?, pod?, constraints })
 */
export function buildMandateGrant({ kind, myWebid, offeringKey, scope } = {}) {
  const k = kind ?? (offeringKey ? 'offering' : (scope ? 'resource' : 'actAs'));
  switch (k) {
    case 'offering':
      return {
        actingAs: myWebid,
        ...(offeringKey ? { skill: offeringKey } : {}),
        // Brokered by construction: keys stay with the granter, only answers travel.
        constraints: { broker: true },
      };
    case 'resource':
      // Path-scoped brokered read: the device stays the scope authority and keys
      // never leave (via:'device'). Maps to the PodCapabilityToken / agent-proxy model.
      return {
        pod: scope,
        constraints: { broker: true, via: 'device' },
      };
    case 'actAs':
    default:
      return { actingAs: myWebid, constraints: { broker: true } };
  }
}

/**
 * The grant-KIND taxonomy driving the WAARVOOR menu. Each spec expands into 0+
 * selectable option rows; adding a kind = one entry here. An option:
 *   `{ kind, id, label, params, active, note? }`
 * `params` is spread into `buildMandateGrant` on confirm; `active:false` rows are
 * shown (legible taxonomy) but not issuable (honest "nog niet actief").
 */
export const GRANT_KIND_SPECS = [
  {
    kind: 'actAs',
    expand: ({ tr }) => [{
      kind: 'actAs', id: 'actAs',
      label: tr('circle.mandate.on_your_behalf'),
      params: {}, active: true,
    }],
  },
  {
    kind: 'offering',
    groupLabelKey: 'circle.mandate.kind.offering',
    // One row per offering the owner HOLDS — visible attenuation. None held → none.
    expand: ({ offerings, tr }) => (Array.isArray(offerings) ? offerings : [])
      .filter((o) => o && o.key)
      .map((o) => ({
        kind: 'offering', id: `offering:${o.key}`,
        label: o.text || o.label || o.key,
        params: { offeringKey: o.key }, active: true,
      })),
  },
  {
    kind: 'resource',
    // HONEST first-class entry — see the module header. Not issuable yet.
    expand: ({ tr }) => [{
      kind: 'resource', id: 'resource',
      label: tr('circle.mandate.kind.resource'),
      note:  tr('circle.mandate.kind.resource_note'),
      params: {}, active: false,
    }],
  },
];

/**
 * Expand the taxonomy into render-ready groups `[{ groupLabelKey, rows:[opt] }]`.
 * A kind that expands to zero rows (e.g. offerings when you hold none) is omitted.
 */
export function grantKindOptions({ offerings = [], t } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const groups = [];
  for (const spec of GRANT_KIND_SPECS) {
    const rows = spec.expand({ offerings, tr });
    if (rows.length) groups.push({ groupLabelKey: spec.groupLabelKey ?? null, rows });
  }
  return groups;
}

/** A member's display label — a short name, falling back to a trimmed WebID. */
function memberLabel(m) {
  if (!m || typeof m !== 'object') return '';
  const name = m.name ?? m.displayName ?? m.label ?? '';
  if (name) return name;
  const w = m.webid ?? m.id ?? '';
  return typeof w === 'string' && w ? (w.split(/[/#]/).filter(Boolean).pop() || w).slice(0, 24) : '';
}

/** A member's WebID (the `member` arg for `attachTaskGrant`). */
function memberWebid(m) {
  return (m && (m.webid ?? m.id)) || null;
}

/**
 * Render the entrust picker into `container`.
 *
 * @param {HTMLElement} container
 * @param {object} o
 * @param {Array}  [o.members=[]]        the circle roster ({webid,name,…})
 * @param {Array}  [o.offerings=[]]      MY offerings ({key,text}); [] → single "namens jou"
 * @param {string} o.taskId
 * @param {string} o.myWebid
 * @param {Array}  [o.existingGrants=[]] the task's `source.taskGrants` ({member,skill})
 * @param {function} o.t
 * @param {(g:{taskId,member,grant})=>void} o.onConfirm
 * @param {()=>void} o.onCancel
 * @param {boolean} [o.busy=false]
 * @param {string|null} [o.notice=null]
 * @returns {HTMLElement}
 */
export function renderMandatePicker(container, {
  members = [],
  offerings = [],
  taskId = null,
  myWebid = null,
  existingGrants = [],
  t,
  onConfirm,
  onCancel,
  busy = false,
  notice = null,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-mandate-picker';

  // Selectable roster — everyone but me (you don't entrust a task to yourself).
  const roster = (Array.isArray(members) ? members : [])
    .filter((m) => memberWebid(m) && memberWebid(m) !== myWebid);

  let pickedMember = null;      // WebID
  let pickedWhat = null;        // the selected grant-kind option (from grantKindOptions)

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-mandate-picker__header';
  const title = document.createElement('h3');
  title.className = 'cc-mandate-picker__title';
  title.style.cssText = 'margin:0;font-family:var(--font-sans);color:var(--ink)';
  title.textContent = tr('circle.mandate.heading');
  header.appendChild(title);
  if (typeof onCancel === 'function') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cc-mandate-picker__cancel';
    cancel.style.cssText = 'background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:1.1em';
    cancel.textContent = tr('circle.mandate.cancel');
    cancel.addEventListener('click', () => onCancel());
    header.appendChild(cancel);
  }
  container.appendChild(header);

  const sub = document.createElement('p');
  sub.className = 'cc-mandate-picker__sub';
  sub.style.cssText = 'margin:4px 0 12px;color:var(--ink-soft);font-size:0.9em';
  sub.textContent = tr('circle.mandate.intro');
  container.appendChild(sub);

  if (notice) {
    const n = document.createElement('div');
    n.className = 'cc-mandate-picker__notice';
    n.style.cssText = 'margin:0 0 10px;padding:8px;border-radius:var(--radius-sm);background:var(--paper-2);color:var(--ink);font-size:0.9em';
    n.textContent = notice;
    container.appendChild(n);
  }

  // ── Existing mandates (legibility) ──────────────────────────────────────────
  if (Array.isArray(existingGrants) && existingGrants.length) {
    container.appendChild(renderMandateLegibility(existingGrants, { members, offerings, t: tr }));
  }

  const sectionLabel = (key) => {
    const l = document.createElement('div');
    l.className = 'cc-mandate-picker__label';
    l.style.cssText = 'font-size:0.78em;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-soft);margin:12px 0 6px';
    l.textContent = tr(key);
    return l;
  };

  const confirmBtn = document.createElement('button');   // referenced by the pickers below

  // ── WHO ─────────────────────────────────────────────────────────────────────
  container.appendChild(sectionLabel('circle.mandate.who_label'));
  if (!roster.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-mandate-picker__empty';
    empty.style.cssText = 'color:var(--ink-soft);font-size:0.9em;margin:0 0 8px';
    empty.textContent = tr('circle.mandate.who_empty');
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'cc-mandate-picker__who';
    list.setAttribute('role', 'radiogroup');
    for (const m of roster) {
      const w = memberWebid(m);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-mandate-picker__who-item';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.member = w;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 4px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--ink);cursor:pointer';
      btn.textContent = memberLabel(m);
      btn.addEventListener('click', () => {
        pickedMember = w;
        for (const el of list.querySelectorAll('.cc-mandate-picker__who-item')) {
          const on = el.dataset.member === w;
          el.setAttribute('aria-checked', on ? 'true' : 'false');
          el.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
          el.style.background = on ? 'var(--paper-2)' : 'var(--card)';
        }
        syncConfirm();
      });
      list.appendChild(btn);
    }
    container.appendChild(list);
  }

  // ── WAARVOOR (WHAT) — the data-driven grant-KIND taxonomy ────────────────────
  container.appendChild(sectionLabel('circle.mandate.what_label'));
  const whatList = document.createElement('div');
  whatList.className = 'cc-mandate-picker__what';
  whatList.setAttribute('role', 'radiogroup');

  // An honest note area shown when the selected kind can't be issued yet
  // (e.g. the "resource" kind while the brokered device-fetch path is unwired).
  const whatNote = document.createElement('div');
  whatNote.className = 'cc-mandate-picker__what-note';
  whatNote.style.cssText = 'margin:2px 0 4px;padding:8px;border-radius:var(--radius-sm);background:var(--paper-2);color:var(--ink-soft);font-size:0.85em;line-height:1.4';
  whatNote.hidden = true;

  const selectWhat = (opt) => {
    pickedWhat = opt;
    for (const el of whatList.querySelectorAll('.cc-mandate-picker__what-item')) {
      const on = el.dataset.what === opt.id;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
      el.style.background = on ? 'var(--paper-2)' : 'var(--card)';
    }
    if (opt.note) { whatNote.textContent = opt.note; whatNote.hidden = false; }
    else { whatNote.hidden = true; whatNote.textContent = ''; }
    syncConfirm();
  };

  // Expand the taxonomy → grouped, selectable option rows. Adding a grant kind is
  // a one-entry change in GRANT_KIND_SPECS; this render stays generic.
  const whatGroups = grantKindOptions({ offerings, t: tr });
  let firstActiveOpt = null;
  for (const group of whatGroups) {
    if (group.groupLabelKey) whatList.appendChild(sectionLabel(group.groupLabelKey));
    for (const opt of group.rows) {
      if (!firstActiveOpt && opt.active) firstActiveOpt = opt;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-mandate-picker__what-item';
      btn.setAttribute('role', 'radio');
      btn.dataset.what = opt.id;
      btn.dataset.kind = opt.kind;
      if (!opt.active) btn.dataset.inactive = 'true';
      btn.setAttribute('aria-checked', 'false');
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 4px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--ink);cursor:pointer';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => selectWhat(opt));
      whatList.appendChild(btn);
    }
  }
  container.appendChild(whatList);
  container.appendChild(whatNote);
  // (Default selection happens after syncConfirm is defined — see below.)

  // ── The promise (temporary + brokered) ───────────────────────────────────────
  const promise = document.createElement('div');
  promise.className = 'cc-mandate-picker__promise';
  promise.style.cssText = 'margin:12px 0;padding:10px;border-radius:var(--radius-sm);background:var(--green-bg);color:var(--ink);font-size:0.86em;line-height:1.4';
  for (const key of ['circle.mandate.temporary', 'circle.mandate.brokered']) {
    const line = document.createElement('div');
    line.textContent = tr(key);
    promise.appendChild(line);
  }
  container.appendChild(promise);

  // ── Confirm ───────────────────────────────────────────────────────────────
  confirmBtn.type = 'button';
  confirmBtn.className = 'cc-mandate-picker__confirm';
  confirmBtn.style.cssText = 'width:100%;padding:10px;border:none;border-radius:var(--radius);background:var(--accent);color:var(--accent-contrast);font-weight:600;cursor:pointer';
  confirmBtn.textContent = tr('circle.mandate.confirm');
  const syncConfirm = () => {
    // Confirmable only for an ISSUABLE grant kind — an inactive "nog niet actief"
    // kind (e.g. resource) is selectable/legible but never dispatched.
    const enabled = !busy && !!pickedMember && !!(pickedWhat && pickedWhat.active);
    confirmBtn.disabled = !enabled;
    confirmBtn.style.opacity = enabled ? '1' : '0.5';
    confirmBtn.style.cursor = enabled ? 'pointer' : 'default';
  };
  confirmBtn.addEventListener('click', () => {
    if (busy || !pickedMember || !(pickedWhat && pickedWhat.active) || typeof onConfirm !== 'function') return;
    onConfirm({
      taskId,
      member: pickedMember,
      grant: buildMandateGrant({ myWebid, kind: pickedWhat.kind, ...pickedWhat.params }),
    });
  });
  // Default the WAARVOOR to the first issuable option ("namens jou") now that
  // syncConfirm exists (selectWhat calls it). Falls through to a plain sync when
  // there is no active option (defensive).
  if (firstActiveOpt) selectWhat(firstActiveOpt);
  else syncConfirm();
  container.appendChild(confirmBtn);

  return container;
}

/**
 * Compact legibility list for a task's existing mandates — who + what, with the
 * standing note that they lift when the task closes. Pure; exported so the row
 * renderer and the picker share it.
 *
 * @param {Array<{member:string, skill?:string}>} grants
 * @param {object} [o]
 * @param {Array} [o.members=[]]    roster, to resolve a member label
 * @param {Array} [o.offerings=[]]  MY offerings, to resolve a skill label
 * @param {function} [o.t]
 * @returns {HTMLElement}
 */
export function renderMandateLegibility(grants, { members = [], offerings = [], t } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const wrap = document.createElement('div');
  wrap.className = 'cc-mandate-legibility';
  wrap.style.cssText = 'margin:0 0 8px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card)';

  const heading = document.createElement('div');
  heading.className = 'cc-mandate-legibility__heading';
  heading.style.cssText = 'font-size:0.78em;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 4px';
  heading.textContent = tr('circle.mandate.existing_heading');
  wrap.appendChild(heading);

  const byWebid = new Map((members || []).map((m) => [(m && (m.webid ?? m.id)) || '', m]));
  const offeringLabel = new Map((offerings || []).filter((o) => o && o.key).map((o) => [o.key, o.text || o.label || o.key]));

  const list = document.createElement('ul');
  list.className = 'cc-mandate-legibility__list';
  list.style.cssText = 'list-style:none;margin:0;padding:0';
  for (const g of (Array.isArray(grants) ? grants : [])) {
    if (!g || !g.member) continue;
    const li = document.createElement('li');
    li.className = 'cc-mandate-legibility__item';
    li.style.cssText = 'font-size:0.88em;color:var(--ink);margin:0 0 2px';
    li.dataset.member = g.member;
    const who = memberLabel(byWebid.get(g.member)) || (typeof g.member === 'string' ? (g.member.split(/[/#]/).filter(Boolean).pop() || g.member).slice(0, 24) : '');
    const what = g.skill ? (offeringLabel.get(g.skill) || g.skill) : tr('circle.mandate.on_your_behalf');
    li.textContent = tr('circle.mandate.existing_row', { who, what });
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const note = document.createElement('div');
  note.className = 'cc-mandate-legibility__note';
  note.style.cssText = 'font-size:0.8em;color:var(--ink-soft);margin-top:4px';
  note.textContent = tr('circle.mandate.existing_note');
  wrap.appendChild(note);

  return wrap;
}
