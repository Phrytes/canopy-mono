// Shared reply renderer — turns a dispatcher message ({type, ...}) into {text, buttons}
// for any bridge's sendReply (Telegram and canopy-chat both render identically). All prose
// comes from the `s` string table (src/strings); nothing is hardcoded here.

import { getStrings } from '../strings/index.js';

const BTN = (id, label) => ({ id, label });

export function renderMessage(msg, s = getStrings()) {
  switch (msg.type) {
    case 'received':
      return { text: s.received };
    case 'rejected':
      return { text: s.rejected(msg.reason) };
    case 'support':
      return { text: String(msg.resource) };   // project-config text (jurisdiction-specific)
    case 'escalation-offer':
      return {
        text: s.escalationOffer,
        buttons: [BTN('fp:escalate:yes', s.escalateYes), BTN('fp:escalate:no', s.escalateNo)],
      };
    case 'review': {
      if (!msg.points?.length) return { text: s.reviewEmpty };
      // per message: the curated text + (when it changed) the original underneath — the raw→curated compare.
      const lines = msg.points.map((p, i) => {
        const head = `${i + 1}. ${p.text}${p.edited ? ` ${s.editedTag ?? ''}`.trimEnd() : ''}`;
        return (p.raw && p.raw !== p.text) ? `${head}\n   ${s.originalLabel ?? 'origineel'}: ${p.raw}` : head;
      });
      const buttons = [];
      msg.points.forEach((p, i) => {
        buttons.push(BTN(`fp:consent:${p.id}`, s.consentOne(i + 1)));
        buttons.push(BTN(`fp:edit:${p.id}`, s.editOne ? s.editOne(i + 1) : `✏ ${i + 1}`));
      });
      buttons.push(BTN('fp:consent:all', s.consentAll), BTN('fp:cancel', s.cancel));
      return { text: `${s.reviewIntro}\n\n${lines.join('\n')}`, buttons };
    }
    case 'submitted':
      return { text: msg.ids?.length ? s.submitted(msg.ids.length) : s.submittedEmpty };
    // verify-summary loop (Stage 2) — the bubble shows the summary + the points it's based on (the
    // raw-vs-curated compare) + approve/edit/withdraw buttons. Only the approved summary leaves.
    case 'verify-summary': {
      const based = msg.points?.length
        ? `\n\n${s.verifyBasedOn}\n${msg.points.map((p) => `• ${p.text}`).join('\n')}`
        : '';
      return {
        text: `${s.verifyIntro}\n\n“${msg.summary}”${based}`,
        buttons: [BTN('fp:verify', s.verifyConfirm), BTN('fp:verify-edit', s.verifyEdit), BTN('fp:verify-withdraw', s.verifyWithdraw)],
      };
    }
    case 'verified':
      return { text: s.verified };
    case 'verification-withdrawn':
      return { text: s.verificationWithdrawn };
    case 'verify-none':
      return { text: s.verifyNone };
    case 'verification-required':
      return { text: s.verificationRequired };
    case 'consent-failed':
      return { text: s.consentFailed(msg.count ?? 0) };
    case 'contributions':
      return msg.items?.length
        ? { text: [s.contributionsHeader, ...msg.items.map((c, i) => s.contributionLine(i + 1, c.text, c.id))].join('\n') }
        : { text: s.contributionsEmpty };
    case 'withdrawn':
      return { text: s.withdrawn(msg.id) };
    case 'download':
      return msg.items?.length
        ? { text: [s.downloadReady(msg.items.length), ...msg.items.map((c, i) => s.contributionLine(i + 1, c.text, c.id))].join('\n') }
        : { text: s.contributionsEmpty };
    case 'delete':
      return { text: s.deleted(msg.count ?? 0) };
    case 'pause': case 'claim':
      return { text: msg.ok ? s[`${msg.type}Done`] : s.notSupported };
    default:
      return { text: '' };
  }
}
