// Crisis gate (pipeline-order.md Phase 1): crisis routes ONLY when BOTH the deterministic
// lexicon AND the LLM agree; exactly one side → "possible-crisis" (routed for review, never
// dropped). Other signals route on EITHER. Uses an inline LLM whose crisis verdict is driven
// by a marker token, so floor vs llm can be set independently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { aggregateWithThreshold } from '../src/aggregate.js';

function startLlm() {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b);
      const sys = (body.messages.find((m) => m.role === 'system') || {}).content || '';
      const user = (body.messages.slice().reverse().find((m) => m.role === 'user') || {}).content || '';
      let content = '';
      if (/JSON array|domain|triage/i.test(sys)) {
        const lines = user.split('\n').filter((l) => /^\s*\d+\./.test(l));
        const arr = (lines.length ? lines : [user]).map((l, i) => ({ i: i + 1, domain: 'x', signal: /LLMCRISIS/.test(l) ? 'crisis' : 'none', severity: 'low', sensitive: false }));
        content = JSON.stringify(arr);
      } else { content = user; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: {} }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise((x) => srv.close(x)) })));
}

test('crisis = deterministic AND llm; one side only = possible-crisis; other signals = either', async () => {
  const llm = await startLlm();
  process.env.FP_LLM_BASEURL = llm.url;
  const items = [
    { user: 'a', text: 'Ik wil zo niet meer verder leven LLMCRISIS' }, // floor crisis + llm crisis → crisis
    { user: 'b', text: 'Ik wil zo niet meer verder leven' },          // floor crisis only → possible-crisis
    { user: 'c', text: 'het weer is mooi vandaag LLMCRISIS' },        // llm crisis only → possible-crisis
    { user: 'd', text: 'de wachtlijst is lang' },                     // neither → grouped
  ];
  const r = await aggregateWithThreshold('kimi-k2.6', items, { kThreshold: 5, trace: true });
  const sig = Object.fromEntries(r.signals.map((s) => [s.user, s]));
  assert.equal(sig.a.signal, 'crisis');
  assert.equal(sig.a.confirmed, true);
  assert.equal(sig.b.signal, 'possible-crisis');
  assert.equal(sig.b.confirmed, false);
  assert.equal(sig.c.signal, 'possible-crisis');
  assert.ok(!sig.d, 'non-signal message is not on the signal track');
  assert.ok(['dropped', 'review', 'statistical'].includes(r.trace[3].track), `'d' is grouped, not escalated (got ${r.trace[3].track})`);
  await llm.close();
});
