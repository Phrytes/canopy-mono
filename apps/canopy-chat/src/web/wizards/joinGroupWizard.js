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
  const { container, doc, args, callSkill, onClose, onDispatched, sendPeerRedeem } = opts;

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
        const result = await finalSubmit(state, callSkill, sendPeerRedeem);
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
  // Slash-arg parsers sometimes mangle "://" into ":" — tolerate
  // `stoop-invite:base64payload` AND `stoop-invite//base64payload`
  // in addition to the canonical `stoop-invite://base64payload`.
  if (str.startsWith(PREFIX)) {
    str = str.slice(PREFIX.length);
  } else if (str.startsWith('stoop-invite:')) {
    str = str.replace(/^stoop-invite:[\/]*/i, '');
  } else if (str.startsWith('stoop-invite/')) {
    str = str.replace(/^stoop-invite[\/]+/i, '');
  }
  try {
    if (str.startsWith('{')) {
      state.invite = JSON.parse(str);
      return;
    }
    // base64url → base64 → atob → UTF-8 JSON parse
    const padded = str.replace(/-/g, '+').replace(/_/g, '/')
                       + '=='.slice(0, (4 - str.length % 4) % 4);
    if (typeof globalThis.atob !== 'function') {
      throw new Error('no base64 decoder available (browser only)');
    }
    const bin = globalThis.atob(padded);
    // atob returns a Latin-1 binary string.  If the source was
    // UTF-8 JSON, parsing directly may fail on non-ASCII bytes.
    // For invite tokens (pubKey + nonce + sig + ints) everything
    // is ASCII so JSON.parse should work directly.  If it doesn't,
    // surface a clearer diagnostic.
    try {
      state.invite = JSON.parse(bin);
    } catch (innerErr) {
      const snippet = bin.slice(0, 50).replace(/[^\x20-\x7e]/g, '·');
      throw new Error(`base64 decoded to non-JSON: "${snippet}…" — likely the URL was corrupted in transit (paste mangled?).  Try copy-pasting the full URL again.`);
    }
  } catch (err) {
    state.inviteParseError = `Bad invite: ${err.message ?? err}`;
    if (typeof console !== 'undefined') {
      console.warn('[joinGroupWizard] decodeInvite failed', { input: invite, err });
    }
  }
}

async function fetchGroupRules(state, callSkill) {
  // 2026-05-24 — invite URL embeds the rules object (createGroupWizard
  // result.rules), so we can show them WITHOUT querying the local
  // substrate (which has no group-rules item until after join).
  // Fall back to a substrate lookup when the invite has no rules
  // payload (older invites, GroupManager-invite path).
  const embedded = state.invite?.rules;
  if (embedded && typeof embedded === 'object') {
    state.rulesText = summariseEmbeddedRules(embedded);
    return;
  }
  try {
    const reply = await callSkill('stoop', 'getGroupRules', { groupId: state.invite.groupId });
    state.rulesText = reply?.rules ?? reply?.message ?? '(no rules set for this group)';
  } catch (err) {
    state.rulesError = err?.message ?? String(err);
  }
}

/**
 * Format a rules object as readable text — same layout the
 * getGroupRules adapter uses (purpose/access/leave/conflict/tags/
 * admins/freeform).  Keeps the joiner's display consistent with
 * what /group-rules shows post-join.
 */
function summariseEmbeddedRules(r) {
  if (r.rulesText && r.rulesText.trim()) return r.rulesText;
  const parts = [];
  if (r.purpose)        parts.push(`Purpose: ${r.purpose}`);
  if (r.accessPolicy)   parts.push(`Access: ${r.accessPolicy}`);
  if (r.leavePolicy)    parts.push(`Leave: ${r.leavePolicy}`);
  if (r.conflictPolicy) parts.push(`Conflict resolution: ${r.conflictPolicy}`);
  if (Array.isArray(r.tags) && r.tags.length)
    parts.push(`Tags: ${r.tags.join(', ')}`);
  if (Array.isArray(r.additionalAdmins) && r.additionalAdmins.length)
    parts.push(`Extra admins: ${r.additionalAdmins.join(', ')}`);
  return parts.length > 0
    ? parts.join('\n')
    : '(no rules set; defaults apply)';
}

function isValidHandle(handle) {
  return typeof handle === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(handle);
}

/**
 * Final submission: chain the substrate calls in sequence.  Two paths
 * depending on the invite's `kind`:
 *
 *   'membershipCode' (default for /create-group → /join-group):
 *     1. setMyHandle
 *     2. redeemMembershipCode({groupId, code})
 *
 *   'invite' (legacy GroupManager invite from /invite slash):
 *     1. redeemInviteWithGate (records rules-accept audit item)
 *     2. setMyHandle
 *     3. redeemInvite (joins the GroupManager)
 *
 * Aborts on first error so the user sees the FIRST problem.
 */
async function finalSubmit(state, callSkill, sendPeerRedeem) {
  const inv = state.invite;
  // Membership-code path (new — single short string OR encoded URL).
  if (inv?.kind === 'membershipCode' && inv.code && inv.groupId) {
    const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
    if (handle?.ok === false || handle?.error) {
      throw new Error(handle.error ?? 'Couldn\'t set handle.');
    }
    // Local redeem first — works in shared-substrate scenarios (single
    // tab, tests, IndexedDB-shared admin+joiner).
    const redeem = await callSkill('stoop', 'redeemMembershipCode', {
      groupId: inv.groupId, code: inv.code,
    });
    // Cross-instance fallback: when local store has no copy of the code
    // (different browser/device), route the redeem-request to the admin's
    // NKN address embedded in the invite URL.  Admin's substrate
    // validates locally + records the redemption on its side; the bridge
    // returns the confirmation here so we can mirror an audit record.
    if (redeem?.error === 'invalid-or-expired-code' && inv.adminNkn && typeof sendPeerRedeem === 'function') {
      const peerReply = await sendPeerRedeem({
        adminNkn: inv.adminNkn,
        groupId:  inv.groupId,
        code:     inv.code,
      });
      if (!peerReply || peerReply.error) {
        throw new Error(peerReply?.error
          ?? 'Admin\'s substrate did not confirm the code. They may be offline — try again, or ask for a fresh code.');
      }
      // Mirror the confirmation locally so getMyMembershipStatus() works.
      // 2026-05-24 — also persist the rules from the invite URL so
      // /group-rules works on this side post-join.
      await callSkill('stoop', 'recordRemoteRedemption', {
        groupId:     inv.groupId,
        code:        inv.code,
        codeId:      peerReply.codeId ?? null,
        expiresAt:   peerReply.validUntil ?? null,
        confirmedBy: inv.adminNkn,
        ...(inv.rules && typeof inv.rules === 'object' ? { rules: inv.rules } : {}),
      });
      return {
        ok:      true,
        message: `✓ Joined buurt "${inv.groupId}" as ${state.handle} (confirmed by admin over peer-bridge).`,
        groupId: inv.groupId,
        handle:  state.handle,
      };
    }
    if (redeem?.ok === false || redeem?.error) {
      throw new Error(redeem.error ?? 'Couldn\'t redeem code.');
    }
    return {
      ok:      true,
      message: `✓ Joined buurt "${inv.groupId}" as ${state.handle}.`,
      groupId: inv.groupId,
      handle:  state.handle,
    };
  }
  // GroupManager-invite path (legacy / explicit /invite from admin).
  const gate = await callSkill('stoop', 'redeemInviteWithGate', {
    invite:          inv,
    privacyAccepted: state.privacyAccepted,
    rulesAccepted:   state.rulesAccepted,
  });
  if (gate?.ok === false || gate?.error) {
    throw new Error(gate.error ?? 'Gate refused the redeem.');
  }
  const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
  if (handle?.ok === false || handle?.error) {
    throw new Error(handle.error ?? 'Couldn\'t set handle.');
  }
  const redeem = await callSkill('stoop', 'redeemInvite', { invite: inv });
  if (redeem?.ok === false || redeem?.error) {
    throw new Error(redeem.error ?? 'Couldn\'t redeem invite.');
  }
  return {
    ok:      true,
    message: `✓ Joined buurt "${inv.groupId}" as ${state.handle}.`,
    groupId: inv.groupId,
    handle:  state.handle,
  };
}
