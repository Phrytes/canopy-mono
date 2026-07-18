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
 * WHAT (attenuation, v1): the default is "namens jou" — act on your behalf,
 * unnarrowed. Optionally the owner narrows it to ONE of their OWN offerings; only
 * offerings the owner holds appear, so the attenuation is the visible menu.
 */

/**
 * Build the grant object dispatched with `attachTaskGrant`. Pure.
 *
 * @param {object} o
 * @param {string} o.myWebid        the granter (acts as this identity — "namens jou")
 * @param {string} [o.offeringKey]  narrow the mandate to one of MY offerings (its key)
 * @returns {{ actingAs:string, skill?:string, constraints:{ broker:boolean } }}
 */
export function buildMandateGrant({ myWebid, offeringKey } = {}) {
  return {
    actingAs: myWebid,
    ...(offeringKey ? { skill: offeringKey } : {}),
    // Brokered by construction: keys stay with the granter, only answers travel.
    constraints: { broker: true },
  };
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
  let pickedOffering = null;    // offering key, or null = "namens jou"

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

  // ── WHAT (attenuation) ───────────────────────────────────────────────────────
  container.appendChild(sectionLabel('circle.mandate.what_label'));
  const whatList = document.createElement('div');
  whatList.className = 'cc-mandate-picker__what';
  whatList.setAttribute('role', 'radiogroup');

  // Option rows: "namens jou" (default, key=null) + one row per offering I hold.
  const whatOptions = [
    { key: null, label: tr('circle.mandate.on_your_behalf') },
    ...(Array.isArray(offerings) ? offerings : [])
      .filter((o) => o && o.key)
      .map((o) => ({ key: o.key, label: o.text || o.label || o.key })),
  ];
  for (const opt of whatOptions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-mandate-picker__what-item';
    btn.setAttribute('role', 'radio');
    btn.dataset.offering = opt.key ?? '';
    const isDefault = opt.key === null;
    btn.setAttribute('aria-checked', isDefault ? 'true' : 'false');
    btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 4px;border:1px solid ${isDefault ? 'var(--accent)' : 'var(--line)'};border-radius:var(--radius-sm);background:${isDefault ? 'var(--paper-2)' : 'var(--card)'};color:var(--ink);cursor:pointer`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      pickedOffering = opt.key;
      for (const el of whatList.querySelectorAll('.cc-mandate-picker__what-item')) {
        const on = (el.dataset.offering || '') === (opt.key ?? '');
        el.setAttribute('aria-checked', on ? 'true' : 'false');
        el.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
        el.style.background = on ? 'var(--paper-2)' : 'var(--card)';
      }
    });
    whatList.appendChild(btn);
  }
  pickedOffering = null;   // default = "namens jou"
  container.appendChild(whatList);

  // TODO(seam): when a richer per-offering scope model lands, the WHAT options
  // here plug into the same `offerings` source the "Mij" surface uses
  // (driversFromProperties filtered to kind 'offering'); v1 attenuation is
  // "namens jou" ± one whole offering.

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
    const enabled = !busy && !!pickedMember;
    confirmBtn.disabled = !enabled;
    confirmBtn.style.opacity = enabled ? '1' : '0.5';
    confirmBtn.style.cursor = enabled ? 'pointer' : 'default';
  };
  confirmBtn.addEventListener('click', () => {
    if (busy || !pickedMember || typeof onConfirm !== 'function') return;
    onConfirm({
      taskId,
      member: pickedMember,
      grant: buildMandateGrant({ myWebid, offeringKey: pickedOffering }),
    });
  });
  syncConfirm();
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
