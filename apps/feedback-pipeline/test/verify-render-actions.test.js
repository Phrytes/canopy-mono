// Verify-summary loop — channel render + control grammar (the bubble + buttons), Slice 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage } from '../src/channel/render.js';
import { parseControl, runAction } from '../src/channel/actions.js';
import { getStrings } from '../src/strings/index.js';

const s = getStrings();

test('render: verify-summary → summary + the points it is based on + approve/edit/withdraw buttons', () => {
  const r = renderMessage({ type: 'verify-summary', round: 1, summary: 'my summary', points: [{ id: 'p1', text: 'raw one' }] }, s);
  assert.match(r.text, /my summary/);
  assert.match(r.text, /raw one/, 'shows the raw point (the compare)');
  assert.deepEqual(r.buttons.map((b) => b.id), ['fp:verify', 'fp:verify-edit', 'fp:verify-withdraw']);
});

test('render: verified / withdrawn / none map to their strings', () => {
  assert.equal(renderMessage({ type: 'verified' }, s).text, s.verified);
  assert.equal(renderMessage({ type: 'verification-withdrawn' }, s).text, s.verificationWithdrawn);
  assert.equal(renderMessage({ type: 'verify-none' }, s).text, s.verifyNone);
});

test('parseControl: the verify button callbacks', () => {
  assert.deepEqual(parseControl('fp:verify'), { kind: 'verify' });
  assert.deepEqual(parseControl('fp:verify-withdraw'), { kind: 'verify-withdraw' });
  assert.deepEqual(parseControl('fp:verify-edit'), { kind: 'verify-edit', text: undefined });
  assert.deepEqual(parseControl('fp:verify-edit: my words'), { kind: 'verify-edit', text: 'my words' });
});

test('runAction: verify/withdraw route to the dispatcher; [Edit] prompts then the next msg rewords', async () => {
  const calls = [];
  const dispatcher = {
    verifySummary: async () => { calls.push(['verify']); },
    withdrawVerification: async () => { calls.push(['withdraw']); },
    editVerificationSummary: async (t) => { calls.push(['edit', t]); },
    handleMessage: async (t) => { calls.push(['message', t]); },
  };
  const said = [];
  const session = { dispatcher, points: [] };
  const say = async (text) => { said.push(text); };

  await runAction(parseControl('fp:verify'), { session, say, strings: s });
  await runAction(parseControl('fp:verify-withdraw'), { session, say, strings: s });

  await runAction(parseControl('fp:verify-edit'), { session, say, strings: s });      // tap [Edit]
  assert.equal(session.awaitingEdit, true);
  assert.ok(said.includes(s.verifyEditPrompt), 'bot prompts for the reworded version');

  await runAction({ kind: 'message', text: 'my own wording' }, { session, say, strings: s });  // free text → edit
  assert.equal(session.awaitingEdit, false, 'edit mode consumed');

  await runAction(parseControl('fp:verify-edit: inline text'), { session, say, strings: s });   // direct edit w/ text

  assert.deepEqual(calls, [['verify'], ['withdraw'], ['edit', 'my own wording'], ['edit', 'inline text']]);
});

test('runAction: a normal message (no edit pending) still goes to handleMessage', async () => {
  const calls = [];
  const dispatcher = { handleMessage: async (t) => { calls.push(t); } };
  await runAction({ kind: 'message', text: 'a feedback message' }, { session: { dispatcher, points: [] }, say: async () => {}, strings: s });
  assert.deepEqual(calls, ['a feedback message']);
});
