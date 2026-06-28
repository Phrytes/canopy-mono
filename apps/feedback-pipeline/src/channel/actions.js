// Shared control grammar + action executor for every channel. A channel front-end turns
// inbound text into an ACTION (see shapes below) — Telegram by an explicit slash/button
// grammar, canopy-chat by a natural-language intent classifier — and both hand the action
// here. This keeps the participant journey identical across surfaces (architecture §1.3).
//
// Action shapes:
//   { kind: 'message', text }            a feedback message (the default)
//   { kind: 'review' }                   show the reviewable point list
//   { kind: 'consent', all|ids|index }   hand over points (the consent = write action)
//   { kind: 'withdraw', arg }            withdraw a contribution by id
//   { kind: 'my-contributions' }         list mine
//   { kind: 'menu' | 'help' | 'cancel' | 'escalate-yes' | 'escalate-no' }

/** Parse the explicit control grammar (slash commands + fp: button callbacks). Returns an
 *  action, or null when the text is not a control utterance (a channel decides what null
 *  means: Telegram → a feedback message; canopy-chat → run the NL classifier). */
export function parseControl(text) {
  const t = (text || '').trim();
  if (t === '/start' || t === '/menu' || t === 'fp:menu') return { kind: 'menu' };
  if (t === '/help') return { kind: 'help' };
  // /bekijk is the primary "check my points so far" command — it's an in-between view, NOT a finish (you can
  // keep sending + editing after). /klaar/done kept as aliases (habit/back-compat).
  if (t === '/bekijk' || t === '/klaar' || t === '/done' || t === '/review' || t === 'fp:review') return { kind: 'review' };
  if (t === 'fp:consent:all') return { kind: 'consent', all: true };
  if (t.startsWith('fp:consent:')) return { kind: 'consent', ids: [t.slice('fp:consent:'.length)] };
  if (t === 'fp:cancel') return { kind: 'cancel' };
  if (t === 'fp:escalate:yes') return { kind: 'escalate-yes' };
  if (t === 'fp:escalate:no') return { kind: 'escalate-no' };
  if (t === '/mijn' || t === '/mine' || t === 'fp:mine') return { kind: 'my-contributions' };
  // verify-summary loop (Stage 2) button callbacks
  if (t === 'fp:verify') return { kind: 'verify' };
  if (t === 'fp:verify-withdraw') return { kind: 'verify-withdraw' };
  const ve = t.match(/^fp:verify-edit(?::\s*(.+))?$/);            // [edit] (then prompt) or fp:verify-edit:<text>
  if (ve) return { kind: 'verify-edit', text: ve[1]?.trim() };
  const pe = t.match(/^fp:edit:([^:]+)(?::([\s\S]+))?$/);         // per-message [edit] (then prompt) or fp:edit:<id>:<text>
  if (pe) return { kind: 'edit-point', id: pe[1], text: pe[2]?.trim() };
  const wd = t.match(/^(?:\/intrekken|\/withdraw|fp:withdraw:)\s*(.+)$/);
  if (wd) return { kind: 'withdraw', arg: wd[1].trim() };
  return null;
}

/** Resolve which contribution ids a consent action refers to (all / explicit / by index). */
function consentIds(action, points) {
  const pts = points || [];
  if (action.all) return pts.map((p) => p.id);
  if (action.ids) return action.ids;
  if (Number.isInteger(action.index)) return [pts[action.index - 1]?.id].filter(Boolean);
  return [];
}

/**
 * Execute an action against a chat session.
 * @param {object} action
 * @param {{ session:{dispatcher, points:Array, adapter}, say:(text:string,buttons?:Array)=>Promise<void>, strings:object }} ctx
 */
export async function runAction(action, { session, say, strings: s }) {
  switch (action.kind) {
    case 'menu':
      return say(s.menuWelcome, [{ id: 'fp:review', label: s.menuReview }, { id: 'fp:mine', label: s.menuMine }]);
    case 'help':
      return say(s.help);
    case 'review':
      session.points = await session.dispatcher.review();
      return;
    case 'consent': {
      const ids = consentIds(action, session.points);
      if (!ids.length) { session.points = await session.dispatcher.review(); return; }   // nothing chosen → show the list
      await session.dispatcher.consent(ids);
      return;
    }
    case 'withdraw':
      return void await session.dispatcher.command('withdraw', action.arg);
    case 'my-contributions':
      return void await session.dispatcher.command('my-contributions');
    case 'cancel':
      return say(s.cancelAck);
    case 'escalate-yes':
      return say(s.escalateYesAck);
    case 'escalate-no':
      return say(s.escalateNoAck);
    // verify-summary loop (Stage 2)
    case 'verify':
      return void await session.dispatcher.verifySummary();
    case 'verify-withdraw':
      return void await session.dispatcher.withdrawVerification();
    case 'verify-edit':
      if (action.text) { session.awaitingEdit = false; return void await session.dispatcher.editVerificationSummary(action.text); }
      session.awaitingEdit = true;                                 // [Edit] tapped → the next free text rewords it
      return say(s.verifyEditPrompt);
    case 'edit-point':                                             // per-message [Bewerk] — inline text, or prompt
      if (action.text) { session.awaitingEditPoint = null; session.dispatcher.editPoint(action.id, action.text); return void await session.dispatcher.showReview(); }
      session.awaitingEditPoint = action.id;                       // tapped without text → the next free text edits it
      return say(s.editPointPrompt ?? s.verifyEditPrompt);
    case 'message':
    default:
      if (session.awaitingEdit) { session.awaitingEdit = false; return void await session.dispatcher.editVerificationSummary(action.text); }
      if (session.awaitingEditPoint) { const id = session.awaitingEditPoint; session.awaitingEditPoint = null; session.dispatcher.editPoint(id, action.text); return void await session.dispatcher.showReview(); }
      return void await session.dispatcher.handleMessage(action.text);
  }
}
