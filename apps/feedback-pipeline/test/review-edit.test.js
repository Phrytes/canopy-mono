// Stage 1 — the user's optional per-message review: raw→curated compare + per-point edit (render + grammar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage } from '../src/channel/render.js';
import { parseControl, runAction } from '../src/channel/actions.js';
import { getStrings } from '../src/strings/index.js';

const s = getStrings();
const ORIG = typeof s.originalLabel === 'string' ? s.originalLabel : 'original';

test('render: review shows curated + the original (raw→curated compare) + per-point ✏ edit', () => {
  const r = renderMessage({ type: 'review', points: [{ id: 'p1', text: 'cleaned text', raw: 'rude RAW text' }] }, s);
  assert.match(r.text, /cleaned text/);
  assert.match(r.text, /rude RAW text/, 'shows the original underneath (the compare)');
  assert.match(r.text, new RegExp(`${ORIG}:`), 'labels it as the original');
  const ids = r.buttons.map((b) => b.id);
  assert.ok(ids.includes('fp:consent:p1'), 'send button');
  assert.ok(ids.includes('fp:edit:p1'), 'per-point edit button');
  assert.ok(ids.includes('fp:consent:all') && ids.includes('fp:cancel'));
});

test('render: review omits the original line when curated === raw (nothing changed)', () => {
  const r = renderMessage({ type: 'review', points: [{ id: 'p1', text: 'same', raw: 'same' }] }, s);
  assert.ok(!r.text.includes(`${ORIG}:`), 'no original line when unchanged');
});

test('parseControl: per-message edit callbacks (prompt + inline)', () => {
  assert.deepEqual(parseControl('fp:edit:p2'), { kind: 'edit-point', id: 'p2', text: undefined });
  assert.deepEqual(parseControl('fp:edit:p2:my new wording'), { kind: 'edit-point', id: 'p2', text: 'my new wording' });
});

test('runAction: [✏] inline edits + re-shows; [✏] alone prompts, then the next msg edits', async () => {
  const calls = [];
  const dispatcher = {
    editPoint: (id, t) => { calls.push(['edit', id, t]); },
    showReview: async () => { calls.push(['showReview']); },
    handleMessage: async (t) => { calls.push(['message', t]); },
  };
  const said = [];
  const session = { dispatcher, points: [{ id: 'p1', text: 'x' }] };
  const say = async (text) => { said.push(text); };

  // inline: fp:edit:p1:corrected → editPoint + showReview (no re-curation)
  await runAction(parseControl('fp:edit:p1:corrected'), { session, say, strings: s });
  assert.deepEqual(calls, [['edit', 'p1', 'corrected'], ['showReview']]);

  // prompt: fp:edit:p1 (no text) → awaitingEditPoint + say
  calls.length = 0; said.length = 0;
  await runAction(parseControl('fp:edit:p1'), { session, say, strings: s });
  assert.equal(session.awaitingEditPoint, 'p1');
  assert.equal(said.length, 1, 'prompted for the correction');

  // the next free text → editPoint(awaiting) + showReview, clears the flag
  await runAction({ kind: 'message', text: 'typed correction' }, { session, say, strings: s });
  assert.deepEqual(calls, [['edit', 'p1', 'typed correction'], ['showReview']]);
  assert.equal(session.awaitingEditPoint, null);
});
