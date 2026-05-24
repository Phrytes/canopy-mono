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

// State-machine pieces (decodeInvite, summariseEmbeddedRules,
// fetchGroupRules, isValidHandle, handleSuggestions, finalSubmit,
// PRIVACY_NOTICE) moved to ../../core/wizards/joinGroupState.js
// (#231.2c) so canopy-chat-mobile's RN wizard can reuse them.
import {
  PRIVACY_NOTICE,
  handleSuggestions as HANDLE_SUGGESTIONS,
  decodeInvite,
  isValidHandle,
  initialState,
  fetchGroupRules,
  finalSubmit,
} from '../../core/wizards/joinGroupState.js';

const PRIVACY_NOTICE_NL = PRIVACY_NOTICE.nl;
const PRIVACY_NOTICE_EN = PRIVACY_NOTICE.en;

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
  const { container, doc, args, callSkill, onClose, onDispatched, sendPeerRedeem } = opts;

  // Wizard state — kept in-scope, re-renders rebuild the DOM from it.
  const state = initialState();

  // Decode the invite arg (URL form or pre-decoded object).
  decodeInvite(args?.invite, state);

  // Kick off the rules fetch when state.step === 1.
  if (state.invite && !state.inviteParseError) {
    fetchGroupRules({ state, callSkill }).then(rerender).catch((err) => {
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
      rerender(); // show submitting state
      const { result } = await finalSubmit({ state, callSkill, sendPeerRedeem });
      if (result) {
        if (typeof onDispatched === 'function') {
          try { onDispatched(result); } catch { /* swallow */ }
        }
        onClose();
        return;
      }
      rerender(); // failure path: show submitError
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

  // Slice 4 (2026-05-24) — mesh address-sharing consent.  When on,
  // admin propagates this joiner's NKN address to other consenting
  // members + propagates other consenting members' addresses to
  // this joiner.  When off, the joiner only talks to admin (star
  // routing); other members can't DM directly.
  const meshRow = doc.createElement('label');
  meshRow.className = 'cc-wizard-check';
  const meshBox = doc.createElement('input');
  meshBox.type = 'checkbox';
  meshBox.checked = state.shareAddress;
  meshBox.addEventListener('change', () => {
    state.shareAddress = meshBox.checked;
  });
  meshRow.appendChild(meshBox);
  meshRow.appendChild(doc.createTextNode(' Let other buurt members contact me directly (DM).'));
  wrap.appendChild(meshRow);
  const meshHint = doc.createElement('div');
  meshHint.className = 'cc-wizard-field-hint';
  meshHint.textContent = 'Off = admin relays everything; you stay reachable only via them.';
  wrap.appendChild(meshHint);

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

// decodeInvite, fetchGroupRules, summariseEmbeddedRules,
// isValidHandle moved to ../../core/wizards/joinGroupState.js
// (#231.2c).

// finalSubmit moved to ../../core/wizards/joinGroupState.js (#231.2c).
// The lifted version wraps the chain in a {result, state} envelope +
// mutates state.submitting/submitError; see the call site in rerender().
