/**
 * **Platform: web** (DOM-dependent).  RN parallel pending #128.
 *
 * canopy-chat — C1 create-group wizard (#197, 2026-05-24).
 *
 * 5-step wizard surfacing stoop.createGroupV2 — substantially richer
 * than C2 (join-group): 14 distinct configuration questions across
 * identity, governance, rules, and technical settings.  Lands the
 * buurt + mints the first membership code (shown ONCE per stoop's
 * design — the user must copy it or it's lost).
 *
 * Substrate skill: stoop.createGroupV2
 * Returns: { groupId, code, expiresAt, ... } — the code is the
 * one-time-shown membership code for early members.
 *
 * Open via: /create-group  (no slash args needed; wizard collects
 * everything).  Custom renderer in main.js's WIZARD_RENDERERS map.
 */

const ACCESS_POLICIES = [
  { id: 'invite-only', label: 'Invite only (admins issue invites)' },
  { id: 'request',     label: 'Request to join (admins approve)' },
  { id: 'open',        label: 'Open (anyone with the buurt id joins)' },
];

const LEAVE_POLICIES = [
  { id: 'anyone',        label: 'Anyone can leave at any time' },
  { id: 'notify-first',  label: 'Leavers notify the buurt before going' },
];

const CONFLICT_POLICIES = [
  { id: 'admin-decides', label: 'Admin decides' },
  { id: 'mediation',     label: 'Mediation by two random members' },
  { id: 'vote',          label: 'Member vote' },
];

const STORAGE_POLICIES = [
  { id: 'no-pod',        label: 'No pod (local state only — simplest)' },
  { id: 'decentralised', label: 'Decentralised (per-member pods sync)' },
  { id: 'centralised',   label: 'Centralised (one group pod — needs URI)' },
  { id: 'hybrid',        label: 'Hybrid (per-member + group pod — needs URI)' },
];

const KEY_ROTATION_MODES = [
  { id: 'admin-only',         label: 'Admin-only (rotation requires admin action)' },
  { id: 'peer-distributable', label: 'Peer-distributable (any active member can rotate)' },
];

/**
 * Wizard renderer for /create-group.
 *
 * @param {object}   opts
 * @param {HTMLElement} opts.container
 * @param {Document}    opts.doc
 * @param {object}      opts.args
 * @param {Function}    opts.callSkill
 * @param {Function}    opts.onClose
 * @param {Function}    [opts.onDispatched]
 */
export function renderCreateGroupWizard(opts) {
  const { container, doc, callSkill, onClose, onDispatched } = opts;

  const state = {
    step: 1,                   // 1..5
    // Step 1 — identity & purpose
    name:        '',
    groupId:     '',
    purpose:     '',
    tags:        '',           // free-form CSV
    // Step 2 — members & governance
    additionalAdmins: '',      // CSV of webids
    accessPolicy:    'invite-only',
    leavePolicy:     'anyone',
    // Step 3 — rules & conflict
    rulesText:        '',
    conflictPolicy:   'mediation',
    // Step 4 — tech & storage
    keyRotationMode: 'admin-only',
    rotationDays:    30,
    storagePolicy:   'no-pod',
    groupPodUri:     '',
    // Submission
    submitting:      false,
    submitError:     null,
    successResult:   null,     // populated on success → step 6 (post-create code reveal)
  };

  rerender();

  function rerender() {
    container.innerHTML = '';
    if (state.successResult) {
      renderSuccessStep(container, doc, state, onClose);
      return;
    }
    renderStepHeader(container, doc, state.step);
    if (state.step === 1) renderIdentityStep(container, doc, state, advance, onClose, rerender);
    if (state.step === 2) renderGovernanceStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 3) renderRulesStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 4) renderTechStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 5) renderReviewStep(container, doc, state, back, onClose, rerender, async () => {
      state.submitting = true;
      state.submitError = null;
      rerender();
      try {
        const result = await finalSubmit(state, callSkill);
        state.successResult = result;
        if (typeof onDispatched === 'function') {
          try { onDispatched({ ok: true, message: `✓ Buurt "${result.groupId}" created.`, ...result }); } catch { /* swallow */ }
        }
      } catch (err) {
        state.submitError = err?.message ?? String(err);
        state.submitting = false;
      }
      rerender();
    });
  }
  function advance() { if (state.step < 5) { state.step += 1; rerender(); } }
  function back()    { if (state.step > 1) { state.step -= 1; rerender(); } }
}

/* ─── step renderers ───────────────────────────────────────── */

const STEP_NAMES = ['Identity', 'Governance', 'Rules', 'Tech', 'Review'];

function renderStepHeader(container, doc, step) {
  const header = doc.createElement('div');
  header.className = 'cc-wizard-steps';
  for (let n = 1; n <= 5; n++) {
    const dot = doc.createElement('span');
    dot.className = `cc-wizard-step ${n === step ? 'cc-wizard-step-active' : ''} ${n < step ? 'cc-wizard-step-done' : ''}`;
    dot.textContent = STEP_NAMES[n - 1];
    header.appendChild(dot);
  }
  container.appendChild(header);
}

function renderIdentityStep(container, doc, state, onNext, onCancel, rerender) {
  const wrap = makeBody(doc, 'Buurt identity & purpose',
    'A buurt is a closed group with its own posts, members, and rules.');

  // The name input updates the auto-derived groupId field WITHOUT
  // rerendering the panel (which would lose focus).  We grab a
  // direct reference to the groupId input after it's appended +
  // mutate its .value on each keystroke.
  let groupIdInputRef = null;
  const refreshNextBtn = () => refreshActionsLocal(container, () =>
    !!state.name.trim() && isValidSlug(state.groupId));

  appendField(wrap, doc, 'Name *', 'name',
    state.name, (v) => {
      state.name = v;
      // Re-derive groupId only if user hasn't manually edited it.
      const derived = slugify(v);
      state.groupId = derived;
      if (groupIdInputRef) groupIdInputRef.value = derived;
      refreshNextBtn();
    },
    { placeholder: 'e.g. Buurt Westend' });
  appendField(wrap, doc, 'Buurt id *', 'groupId',
    state.groupId, (v) => { state.groupId = v; refreshNextBtn(); },
    { placeholder: 'auto-slugified from name', monospace: true,
      hint: 'Lowercase letters, digits, hyphens. Must be unique.' });
  // Capture a ref to the groupId input we just appended (it's the
  // second `.cc-wizard-input` in the wrap).
  groupIdInputRef = wrap.querySelectorAll('.cc-wizard-input')[1] ?? null;

  appendField(wrap, doc, 'Purpose', 'purpose',
    state.purpose, (v) => { state.purpose = v; },
    { placeholder: 'One sentence: what is this buurt for?' });
  appendField(wrap, doc, 'Tags (CSV)', 'tags',
    state.tags, (v) => { state.tags = v; },
    { placeholder: 'e.g. neighbourhood, tools, kids' });

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Cancel', onClick: onCancel, kind: 'secondary' },
    { label: 'Next →', onClick: onNext, kind: 'primary',
      disabled: !state.name.trim() || !isValidSlug(state.groupId),
      validate: 'identityOk' },
  ]);
}

// Local refresh-helper for C1 — the wizardKit's refreshActions uses
// a predicates map; here we just refresh the single primary button.
function refreshActionsLocal(container, ok) {
  const btn = container.querySelector('button[data-cc-validate]');
  if (btn) btn.disabled = !ok();
}

function renderGovernanceStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Members & governance',
    'Who runs the buurt + how people join + how they leave.');

  appendField(wrap, doc, 'Additional admins (CSV of webids)', 'additionalAdmins',
    state.additionalAdmins, (v) => { state.additionalAdmins = v; },
    { placeholder: 'e.g. webid:anne,webid:karl',
      hint: 'You are admin by default. Add others now or invite later.' });
  appendRadioField(wrap, doc, 'Access policy', state.accessPolicy, ACCESS_POLICIES,
    (v) => { state.accessPolicy = v; rerender(); });
  appendRadioField(wrap, doc, 'Leave policy', state.leavePolicy, LEAVE_POLICIES,
    (v) => { state.leavePolicy = v; rerender(); });

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext,   kind: 'primary' },
  ]);
}

function renderRulesStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Rules & conflict resolution',
    'Members see these rules when they accept the invite + when they ask "what does this group expect of me?"');

  const rulesLabel = doc.createElement('div');
  rulesLabel.className = 'cc-wizard-field-label';
  rulesLabel.textContent = 'Buurt rules (free text)';
  wrap.appendChild(rulesLabel);
  const rulesTa = doc.createElement('textarea');
  rulesTa.className = 'cc-wizard-textarea';
  rulesTa.rows = 6;
  rulesTa.placeholder = '1. We treat each other respectfully.\n2. Don\'t share posts off-platform.\n3. ...';
  rulesTa.value = state.rulesText;
  rulesTa.addEventListener('input', () => { state.rulesText = rulesTa.value; });
  wrap.appendChild(rulesTa);

  appendRadioField(wrap, doc, 'Conflict resolution policy', state.conflictPolicy, CONFLICT_POLICIES,
    (v) => { state.conflictPolicy = v; rerender(); });

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext,   kind: 'primary' },
  ]);
}

function renderTechStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Tech & storage',
    'How the buurt stores its data + how the encryption key rotates.');

  appendRadioField(wrap, doc, 'Storage policy', state.storagePolicy, STORAGE_POLICIES,
    (v) => { state.storagePolicy = v; rerender(); });

  // Conditional pod URI field for centralised/hybrid.
  if (state.storagePolicy === 'centralised' || state.storagePolicy === 'hybrid') {
    appendField(wrap, doc, 'Group pod URI *', 'groupPodUri',
      state.groupPodUri, (v) => { state.groupPodUri = v; },
      { placeholder: 'https://group-pod.example/canopy/buurt/',
        hint: 'Required for centralised + hybrid storage.', monospace: true });
  }

  appendRadioField(wrap, doc, 'Key rotation mode', state.keyRotationMode, KEY_ROTATION_MODES,
    (v) => { state.keyRotationMode = v; rerender(); });

  appendField(wrap, doc, 'Rotation interval (days, 1-365)', 'rotationDays',
    String(state.rotationDays),
    (v) => { state.rotationDays = Math.max(1, Math.min(365, parseInt(v, 10) || 30)); },
    { type: 'number' });

  const needsUri = (state.storagePolicy === 'centralised' || state.storagePolicy === 'hybrid');
  const uriOk    = !needsUri || /^https?:\/\//.test(state.groupPodUri.trim());

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Review →',  onClick: onNext, kind: 'primary', disabled: !uriOk },
  ]);
}

function renderReviewStep(container, doc, state, onBack, onCancel, rerender, onSubmit) {
  const wrap = makeBody(doc, 'Review & create', 'Everything you\'ve configured.  After [Create buurt] you\'ll get a one-time membership code to hand out.');

  const dl = doc.createElement('dl');
  dl.className = 'cc-wizard-review';
  appendReview(dl, doc, 'Name',           state.name);
  appendReview(dl, doc, 'Buurt id',       state.groupId);
  if (state.purpose) appendReview(dl, doc, 'Purpose', state.purpose);
  if (state.tags)    appendReview(dl, doc, 'Tags', state.tags);
  if (state.additionalAdmins) appendReview(dl, doc, 'Additional admins', state.additionalAdmins);
  appendReview(dl, doc, 'Access policy',  labelOf(ACCESS_POLICIES, state.accessPolicy));
  appendReview(dl, doc, 'Leave policy',   labelOf(LEAVE_POLICIES, state.leavePolicy));
  if (state.rulesText) appendReview(dl, doc, 'Rules', state.rulesText, { pre: true });
  appendReview(dl, doc, 'Conflict policy', labelOf(CONFLICT_POLICIES, state.conflictPolicy));
  appendReview(dl, doc, 'Storage',        labelOf(STORAGE_POLICIES, state.storagePolicy));
  if (state.groupPodUri) appendReview(dl, doc, 'Group pod URI', state.groupPodUri);
  appendReview(dl, doc, 'Key rotation',   labelOf(KEY_ROTATION_MODES, state.keyRotationMode));
  appendReview(dl, doc, 'Rotation days',  String(state.rotationDays));
  wrap.appendChild(dl);

  if (state.submitError) {
    const err = doc.createElement('div');
    err.className = 'cc-wizard-error';
    err.textContent = state.submitError;
    wrap.appendChild(err);
  }
  if (state.submitting) {
    const status = doc.createElement('div');
    status.className = 'cc-wizard-submitting';
    status.textContent = 'Creating buurt…';
    wrap.appendChild(status);
  }

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',         onClick: onBack,                       kind: 'secondary', disabled: state.submitting },
    { label: 'Cancel',         onClick: onCancel,                     kind: 'secondary', disabled: state.submitting },
    { label: 'Create buurt',   onClick: onSubmit,                     kind: 'primary',   disabled: state.submitting },
  ]);
}

function renderSuccessStep(container, doc, state, onClose) {
  const wrap = makeBody(doc, '✓ Buurt created', `${state.successResult.groupId} is live.`);

  const codeBlock = doc.createElement('div');
  codeBlock.className = 'cc-wizard-code-block';
  const codeLabel = doc.createElement('div');
  codeLabel.className = 'cc-wizard-field-label';
  codeLabel.textContent = 'Membership code (shown ONCE — copy now!)';
  wrap.appendChild(codeLabel);

  const codeRow = doc.createElement('div');
  codeRow.className = 'cc-wizard-code-row';
  const codeText = doc.createElement('code');
  codeText.className = 'cc-wizard-code';
  codeText.textContent = state.successResult.code;
  codeRow.appendChild(codeText);

  const copyBtn = doc.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    try {
      void navigator.clipboard.writeText(state.successResult.code);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    } catch { /* clipboard API unavailable */ }
  });
  codeRow.appendChild(copyBtn);
  wrap.appendChild(codeRow);
  wrap.appendChild(codeBlock);

  const expires = state.successResult.expiresAt
    ? new Date(state.successResult.expiresAt).toLocaleString()
    : '(no expiry)';
  const hint = doc.createElement('p');
  hint.className = 'cc-wizard-blurb';
  hint.textContent = `Expires ${expires}.  After expiry: /rotate-code to mint a fresh one.`;
  wrap.appendChild(hint);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Done', onClick: onClose, kind: 'primary' },
  ]);
}

/* ─── helpers ──────────────────────────────────────────────── */

function makeBody(doc, heading, blurb) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';
  const h = doc.createElement('h3');
  h.textContent = heading;
  wrap.appendChild(h);
  if (blurb) {
    const p = doc.createElement('p');
    p.className = 'cc-wizard-blurb';
    p.textContent = blurb;
    wrap.appendChild(p);
  }
  return wrap;
}

function appendField(wrap, doc, label, name, value, onInput, extra = {}) {
  const labelEl = doc.createElement('label');
  labelEl.className = 'cc-wizard-field';
  const labelText = doc.createElement('span');
  labelText.className = 'cc-wizard-field-label';
  labelText.textContent = label;
  labelEl.appendChild(labelText);
  const input = doc.createElement('input');
  input.type = extra.type ?? 'text';
  input.className = `cc-wizard-input${extra.monospace ? ' cc-wizard-input-mono' : ''}`;
  input.value = value;
  if (extra.placeholder) input.placeholder = extra.placeholder;
  input.addEventListener('input', () => onInput(input.value));
  labelEl.appendChild(input);
  if (extra.hint) {
    const hint = doc.createElement('span');
    hint.className = 'cc-wizard-field-hint';
    hint.textContent = extra.hint;
    labelEl.appendChild(hint);
  }
  wrap.appendChild(labelEl);
}

function appendRadioField(wrap, doc, label, value, options, onPick) {
  const group = doc.createElement('fieldset');
  group.className = 'cc-wizard-radio-group';
  const legend = doc.createElement('legend');
  legend.className = 'cc-wizard-field-label';
  legend.textContent = label;
  group.appendChild(legend);
  for (const o of options) {
    const row = doc.createElement('label');
    row.className = 'cc-wizard-radio';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = `radio-${legend.textContent}`;
    input.value = o.id;
    input.checked = value === o.id;
    input.addEventListener('change', () => onPick(o.id));
    row.appendChild(input);
    row.appendChild(doc.createTextNode(' ' + o.label));
    group.appendChild(row);
  }
  wrap.appendChild(group);
}

function appendReview(dl, doc, label, value, opts = {}) {
  const dt = doc.createElement('dt');
  dt.textContent = label;
  const dd = doc.createElement('dd');
  if (opts.pre) {
    const pre = doc.createElement('pre');
    pre.className = 'cc-wizard-review-pre';
    pre.textContent = value;
    dd.appendChild(pre);
  } else {
    dd.textContent = value;
  }
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function renderActions(container, doc, buttons) {
  const row = doc.createElement('div');
  row.className = 'cc-wizard-actions';
  for (const b of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `cc-wizard-btn cc-wizard-btn-${b.kind ?? 'secondary'} ${b.className ?? ''}`.trim();
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    if (b.validate) btn.setAttribute('data-cc-validate', b.validate);
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  container.appendChild(row);
}

function slugify(s) {
  return String(s ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function isValidSlug(s) {
  return typeof s === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(s);
}

function labelOf(options, id) {
  return options.find((o) => o.id === id)?.label ?? id;
}

/**
 * Final submission: build the `rules` blob from collected fields +
 * call createGroupV2.  Returns the result so the success step can
 * show the one-time membership code.
 */
async function finalSubmit(state, callSkill) {
  const additionalAdmins = state.additionalAdmins
    .split(',').map((s) => s.trim()).filter(Boolean);
  const tags = state.tags
    .split(',').map((s) => s.trim()).filter(Boolean);

  const rules = {
    purpose:           state.purpose || undefined,
    tags:              tags.length > 0 ? tags : undefined,
    additionalAdmins:  additionalAdmins.length > 0 ? additionalAdmins : undefined,
    accessPolicy:      state.accessPolicy,
    leavePolicy:       state.leavePolicy,
    rulesText:         state.rulesText || undefined,
    conflictPolicy:    state.conflictPolicy,
  };
  // Strip undefined keys for a tighter persisted object.
  for (const k of Object.keys(rules)) {
    if (rules[k] === undefined) delete rules[k];
  }

  const result = await callSkill('stoop', 'createGroupV2', {
    groupId:         state.groupId,
    name:            state.name,
    rules,
    keyRotationMode: state.keyRotationMode,
    rotationDays:    state.rotationDays,
    storagePolicy:   state.storagePolicy,
    ...(state.groupPodUri ? { groupPodUri: state.groupPodUri } : {}),
  });
  if (result?.error) {
    throw new Error(result.error);
  }
  return result;
}
