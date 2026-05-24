/**
 * **Platform: web** (DOM-dependent).  RN parallel pending #128.
 *
 * canopy-chat — C3 restore-from-mnemonic wizard (#198, 2026-05-24).
 *
 * 3-step DESTRUCTIVE recovery wizard.  Mnemonic → confirmation →
 * actual restore.  Real skill: stoop.restoreFromMnemonic({mnemonic,
 * confirm: true}) — overwrites the agent's seed in the vault + swaps
 * in a fresh AgentIdentity at runtime (per stoop Phase 31).
 *
 * High-stakes UX: the confirm step is a hard gate (user must check
 * "I understand this overwrites my current identity") + a second
 * checkbox if they have NO backup.  Per [[quality-over-cheap]] we
 * over-communicate the destructiveness.
 */

import { mkBody, mkActions, mkField, mkCheck, mkSteps, mkError, mkSubmitting } from './_wizardKit.js';

export function renderRestoreFromMnemonicWizard(opts) {
  const { container, doc, callSkill, onClose, onDispatched } = opts;

  const state = {
    step:             1,            // 1..3
    mnemonic:         '',
    understandsLoss:  false,
    confirmedNoUndo:  false,
    submitting:       false,
    submitError:      null,
    successResult:    null,
  };

  rerender();

  function rerender() {
    container.innerHTML = '';
    if (state.successResult) return renderSuccessStep(container, doc, state, onClose);
    mkSteps(container, doc, ['Mnemonic', 'Confirm', 'Restore'], state.step);
    if (state.step === 1) renderMnemonicStep();
    if (state.step === 2) renderConfirmStep();
    if (state.step === 3) renderRestoreStep();
  }

  function renderMnemonicStep() {
    const body = mkBody(doc, 'Restore from mnemonic',
      'Enter the 12 or 24-word recovery phrase you saved when you first set up canopy-chat.');
    mkField(body, doc, 'Mnemonic phrase', state.mnemonic, (v) => { state.mnemonic = v; rerender(); }, {
      placeholder: 'word1 word2 word3 ...', monospace: true, hint: 'Words separated by single spaces.',
    });
    container.appendChild(body);
    const words = state.mnemonic.trim().split(/\s+/).filter(Boolean);
    const ok = words.length === 12 || words.length === 24;
    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary' },
      { label: 'Next →', onClick: () => { state.step = 2; rerender(); }, kind: 'primary', disabled: !ok },
    ]);
  }

  function renderConfirmStep() {
    const body = mkBody(doc, 'Confirm — destructive operation',
      'This OVERWRITES your current identity.  You will lose access to anything keyed to the old identity unless YOU still have its mnemonic.  Read carefully.');
    const warn = doc.createElement('div');
    warn.className = 'cc-wizard-warn';
    warn.textContent = '⚠️ After clicking [Restore now], canopy-chat will use the new identity. Your current handle, contacts, group memberships, and pending invites bound to the old identity will appear lost (they aren\'t actually deleted, but you won\'t be able to act on them without the old mnemonic).';
    body.appendChild(warn);
    mkCheck(body, doc, 'I understand this REPLACES my current identity.', state.understandsLoss, (v) => { state.understandsLoss = v; rerender(); });
    mkCheck(body, doc, 'I have saved my current mnemonic somewhere safe (or I don\'t need it).', state.confirmedNoUndo, (v) => { state.confirmedNoUndo = v; rerender(); });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back',    onClick: () => { state.step = 1; rerender(); }, kind: 'secondary' },
      { label: 'Cancel',    onClick: onClose, kind: 'secondary' },
      { label: 'Continue →',onClick: () => { state.step = 3; rerender(); }, kind: 'primary',
        disabled: !(state.understandsLoss && state.confirmedNoUndo) },
    ]);
  }

  function renderRestoreStep() {
    const body = mkBody(doc, 'Restore now', 'One last check.  Click [Restore now] to apply.');
    const summary = doc.createElement('div');
    summary.className = 'cc-wizard-blurb';
    const wordCount = state.mnemonic.trim().split(/\s+/).filter(Boolean).length;
    summary.textContent = `Mnemonic: ${wordCount} words.  After restore you'll be using the new identity immediately.`;
    body.appendChild(summary);
    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Restoring identity…');
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back',     onClick: () => { state.step = 2; rerender(); }, kind: 'secondary', disabled: state.submitting },
      { label: 'Cancel',     onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'Restore now',onClick: async () => {
        state.submitting = true;
        state.submitError = null;
        rerender();
        try {
          const result = await callSkill('stoop', 'restoreFromMnemonic', {
            mnemonic: state.mnemonic.trim(),
            confirm:  true,
          });
          if (result?.error) throw new Error(result.error);
          state.successResult = result;
          if (typeof onDispatched === 'function') {
            try { onDispatched({ ok: true, message: '✓ Identity restored. Reload to refresh the chat-shell.' }); } catch {}
          }
        } catch (err) {
          state.submitError = err?.message ?? String(err);
          state.submitting = false;
        }
        rerender();
      }, kind: 'primary', disabled: state.submitting },
    ]);
  }
}

function renderSuccessStep(container, doc, state, onClose) {
  const body = mkBody(doc, '✓ Identity restored',
    'Your new identity is active.  Reload the page so the chat shell picks up the new pubKey + stableId.');
  const newKey = doc.createElement('code');
  newKey.className = 'cc-wizard-code';
  newKey.textContent = state.successResult?.newPubKey ?? '(unknown)';
  body.appendChild(newKey);
  container.appendChild(body);
  mkActions(container, doc, [
    { label: 'Reload', onClick: () => { onClose(); globalThis.location?.reload?.(); }, kind: 'primary' },
    { label: 'Close',  onClick: onClose, kind: 'secondary' },
  ]);
}
