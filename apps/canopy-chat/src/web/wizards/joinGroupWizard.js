/**
 * **Platform: web** (DOM-dependent).  RN parallel pending #128 +
 * #131 (chat-nav RN + RN renderer port).
 *
 * canopy-chat — C2 join-group wizard (#196, 2026-05-24).
 *
 * 3-step rules-gate wizard that lands new buurt members.  First
 * customRenderer hook on the #180 `openPagePanel` infrastructure;
 * the pattern here is the template other Cluster C wizards reuse.
 *
 * Flow:
 *   /join-group <invite-url>  → opens panel
 *   Step 1: parse invite → fetch group rules → show rules text →
 *           [Accept rules] required to advance
 *   Step 2: show privacy notice → [I accept] required to advance
 *   Step 3: pick a handle (text input + 3 suggestions) → submit
 *           chains redeemInviteWithGate + setMyHandle + redeemInvite
 *           in sequence; on success closes the panel + emits success.
 *
 * Substrate skills exercised:
 *   stoop.getGroupRules      → step 1's rules text
 *   stoop.redeemInviteWithGate → step 3's gated redeem (writes
 *                                rules-accept audit item)
 *   stoop.setMyHandle        → step 3's handle binding
 *   stoop.redeemInvite       → step 3's actual GroupManager redeem
 *
 * Args expected: `{ invite: <string|object> }`.  String form is the
 * `stoop-invite://<base64url-encoded-invite-object>` URL surfaced by
 * the QR rendering in /invite (A9, slice 187).  Object form: the
 * already-decoded invite per stoop's GroupManager.issueInvite shape.
 */

const PRIVACY_NOTICE_NL = `Lid worden van een buurt betekent dat andere
leden je posts kunnen zien, je kunnen aanspreken en — afhankelijk van
groepsregels — kunnen oordelen over conflicten. Buurt-admins hebben
geen toegang tot je privé-chats, alleen tot wat je publiek post.`;

const PRIVACY_NOTICE_EN = `Joining a buurt means other members can see
your posts, contact you, and — depending on group rules — weigh in on
conflicts. Buurt admins have no access to your private chats, only to
what you post publicly.`;

const HANDLE_SUGGESTIONS = (existingDisplayName) => {
  const base = (existingDisplayName ?? 'me').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return [
    base,
    `${base}-${Math.floor(Math.random() * 90 + 10)}`,
    `${base}.${new Date().getFullYear()}`,
  ];
};

/**
 * Wizard renderer for /join-group.  Wired via openPagePanel's
 * `customRenderer` hook in main.js (see joinGroupOpenWizard).
 *
 * @param {object}   opts
 * @param {HTMLElement} opts.container   the panel body
 * @param {Document}    opts.doc
 * @param {object}      opts.args        `{ invite: string|object }`
 * @param {Function}    opts.callSkill   (appOrigin, opId, args) → Promise<payload>
 * @param {Function}    opts.onClose     close the panel
 * @param {Function}    [opts.onDispatched]  fired after final success with the redeemInvite reply
 */
export function renderJoinGroupWizard(opts) {
  const { container, doc, args, callSkill, onClose, onDispatched } = opts;

  // Wizard state — kept in-scope, re-renders rebuild the DOM from it.
  const state = {
    step:             1,            // 1..3
    invite:           null,         // decoded invite object
    inviteParseError: null,         // string if parse failed
    rulesText:        null,         // fetched on step 1 enter
    rulesError:       null,
    rulesAccepted:    false,
    privacyAccepted:  false,
    handle:           '',
    submitting:       false,
    submitError:      null,
  };

  // Decode the invite arg (URL form or pre-decoded object).
  decodeInvite(args?.invite, state);

  // Kick off the rules fetch when state.step === 1.
  if (state.invite && !state.inviteParseError) {
    fetchGroupRules(state, callSkill).then(rerender).catch((err) => {
      state.rulesError = err?.message ?? String(err);
      rerender();
    });
  }

  rerender();

  function rerender() {
    container.innerHTML = '';
    renderStepHeader(container, doc, state);
    if (state.inviteParseError) {
      renderError(container, doc, state.inviteParseError, onClose);
      return;
    }
    if (state.step === 1) renderRulesStep(container, doc, state, () => { state.step = 2; rerender(); }, onClose, rerender);
    if (state.step === 2) renderPrivacyStep(container, doc, state, () => { state.step = 3; rerender(); }, () => { state.step = 1; rerender(); }, onClose, rerender);
    if (state.step === 3) renderHandleStep(container, doc, state, async () => {
      state.submitting = true;
      state.submitError = null;
      rerender();
      try {
        const result = await finalSubmit(state, callSkill);
        if (typeof onDispatched === 'function') {
          try { onDispatched(result); } catch { /* swallow */ }
        }
        onClose();
      } catch (err) {
        state.submitting = false;
        state.submitError = err?.message ?? String(err);
        rerender();
      }
    }, () => { state.step = 2; rerender(); }, onClose, rerender);
  }
}

/* ─── step renderers ───────────────────────────────────────── */

function renderStepHeader(container, doc, state) {
  const header = doc.createElement('div');
  header.className = 'cc-wizard-steps';
  for (let n = 1; n <= 3; n++) {
    const dot = doc.createElement('span');
    dot.className = `cc-wizard-step ${n === state.step ? 'cc-wizard-step-active' : ''} ${n < state.step ? 'cc-wizard-step-done' : ''}`;
    dot.textContent = ['Rules', 'Privacy', 'Handle'][n - 1];
    header.appendChild(dot);
  }
  container.appendChild(header);
}

function renderRulesStep(container, doc, state, onNext, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  heading.textContent = `Buurt: ${state.invite?.groupId ?? '(unknown)'}`;
  wrap.appendChild(heading);

  const blurb = doc.createElement('p');
  blurb.className = 'cc-wizard-blurb';
  blurb.textContent = 'Read the group\'s rules below. Accepting them is required to join.';
  wrap.appendChild(blurb);

  const rulesBox = doc.createElement('pre');
  rulesBox.className = 'cc-wizard-rules';
  rulesBox.textContent = state.rulesError
    ? `(could not load rules: ${state.rulesError})`
    : state.rulesText ?? '(loading rules…)';
  wrap.appendChild(rulesBox);

  const checkRow = doc.createElement('label');
  checkRow.className = 'cc-wizard-check';
  const check = doc.createElement('input');
  check.type = 'checkbox';
  check.checked = state.rulesAccepted;
  check.addEventListener('change', () => {
    state.rulesAccepted = check.checked;
    rerender();
  });
  checkRow.appendChild(check);
  checkRow.appendChild(doc.createTextNode(' I have read and accept the rules.'));
  wrap.appendChild(checkRow);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Decline', onClick: onCancel, kind: 'secondary' },
    { label: 'Next →', onClick: onNext, disabled: !state.rulesAccepted, kind: 'primary' },
  ]);
}

function renderPrivacyStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  heading.textContent = 'Privacy notice';
  wrap.appendChild(heading);

  const notice = doc.createElement('p');
  notice.className = 'cc-wizard-privacy';
  notice.textContent = PRIVACY_NOTICE_EN;
  wrap.appendChild(notice);

  const checkRow = doc.createElement('label');
  checkRow.className = 'cc-wizard-check';
  const check = doc.createElement('input');
  check.type = 'checkbox';
  check.checked = state.privacyAccepted;
  check.addEventListener('change', () => {
    state.privacyAccepted = check.checked;
    rerender();
  });
  checkRow.appendChild(check);
  checkRow.appendChild(doc.createTextNode(' I understand and accept.'));
  wrap.appendChild(checkRow);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext, disabled: !state.privacyAccepted, kind: 'primary' },
  ]);
}

function renderHandleStep(container, doc, state, onSubmit, onBack, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  heading.textContent = 'Pick a handle';
  wrap.appendChild(heading);

  const blurb = doc.createElement('p');
  blurb.className = 'cc-wizard-blurb';
  blurb.textContent = 'How you appear to other buurt members. Lowercase letters, digits, and hyphens.';
  wrap.appendChild(blurb);

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'cc-wizard-handle-input';
  input.value = state.handle;
  input.placeholder = 'handle';
  input.addEventListener('input', () => {
    state.handle = input.value.trim();
    // Don't re-render on every keystroke to preserve focus + caret;
    // only refresh the submit button's disabled state.
    const submitBtn = container.querySelector('.cc-wizard-submit');
    if (submitBtn) submitBtn.disabled = !isValidHandle(state.handle) || state.submitting;
  });
  wrap.appendChild(input);

  const suggestions = doc.createElement('div');
  suggestions.className = 'cc-wizard-suggestions';
  for (const s of HANDLE_SUGGESTIONS()) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'cc-wizard-suggestion';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      state.handle = s;
      rerender();
    });
    suggestions.appendChild(chip);
  }
  wrap.appendChild(suggestions);

  if (state.submitError) {
    const err = doc.createElement('div');
    err.className = 'cc-wizard-error';
    err.textContent = state.submitError;
    wrap.appendChild(err);
  }

  if (state.submitting) {
    const status = doc.createElement('div');
    status.className = 'cc-wizard-submitting';
    status.textContent = 'Joining buurt…';
    wrap.appendChild(status);
  }

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',          onClick: onBack,                                kind: 'secondary', disabled: state.submitting },
    { label: 'Cancel',          onClick: onCancel,                              kind: 'secondary', disabled: state.submitting },
    { label: 'Join buurt',      onClick: onSubmit,
      disabled: !isValidHandle(state.handle) || state.submitting,
      kind: 'primary', className: 'cc-wizard-submit' },
  ]);
}

function renderError(container, doc, message, onClose) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';
  const err = doc.createElement('div');
  err.className = 'cc-wizard-error';
  err.textContent = message;
  wrap.appendChild(err);
  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Close', onClick: onClose, kind: 'secondary' },
  ]);
}

/* ─── helpers ──────────────────────────────────────────────── */

function renderActions(container, doc, buttons) {
  const row = doc.createElement('div');
  row.className = 'cc-wizard-actions';
  for (const b of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `cc-wizard-btn cc-wizard-btn-${b.kind ?? 'secondary'} ${b.className ?? ''}`.trim();
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  container.appendChild(row);
}

function decodeInvite(invite, state) {
  if (!invite) {
    state.inviteParseError = 'No invite supplied — type /join-group <invite-url>.';
    return;
  }
  if (typeof invite === 'object') {
    state.invite = invite;
    return;
  }
  const PREFIX = 'stoop-invite://';
  let str = String(invite).trim();
  if (str.startsWith(PREFIX)) str = str.slice(PREFIX.length);
  // Try base64url decode first; fall back to raw JSON.
  try {
    if (str.startsWith('{')) {
      state.invite = JSON.parse(str);
      return;
    }
    const padded = str.replace(/-/g, '+').replace(/_/g, '/')
                       + '=='.slice(0, (4 - str.length % 4) % 4);
    const json = typeof globalThis.atob === 'function' ? globalThis.atob(padded) : padded;
    state.invite = JSON.parse(json);
  } catch (err) {
    state.inviteParseError = `Bad invite: ${err.message ?? err}`;
  }
}

async function fetchGroupRules(state, callSkill) {
  try {
    const reply = await callSkill('stoop', 'getGroupRules', { groupId: state.invite.groupId });
    state.rulesText = reply?.rules ?? reply?.message ?? '(no rules set for this group)';
  } catch (err) {
    state.rulesError = err?.message ?? String(err);
  }
}

function isValidHandle(handle) {
  return typeof handle === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(handle);
}

/**
 * Final submission: chain the three real-skill calls in sequence.
 * Aborts on first error so the user sees the FIRST problem rather
 * than a cascade.
 */
async function finalSubmit(state, callSkill) {
  // 1. Gate check (records rules-acceptance audit item).
  const gate = await callSkill('stoop', 'redeemInviteWithGate', {
    invite:          state.invite,
    privacyAccepted: state.privacyAccepted,
    rulesAccepted:   state.rulesAccepted,
  });
  if (gate?.ok === false || gate?.error) {
    throw new Error(gate.error ?? 'Gate refused the redeem.');
  }
  // 2. Bind the handle.
  const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
  if (handle?.ok === false || handle?.error) {
    throw new Error(handle.error ?? 'Couldn\'t set handle.');
  }
  // 3. Actually redeem (joins the group's GroupManager).
  const redeem = await callSkill('stoop', 'redeemInvite', { invite: state.invite });
  if (redeem?.ok === false || redeem?.error) {
    throw new Error(redeem.error ?? 'Couldn\'t redeem invite.');
  }
  return {
    ok:      true,
    message: `✓ Joined buurt "${state.invite.groupId}" as ${state.handle}.`,
    groupId: state.invite.groupId,
    handle:  state.handle,
  };
}
