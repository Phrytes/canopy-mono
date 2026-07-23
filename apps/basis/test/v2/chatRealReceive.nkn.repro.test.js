import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverNkn, pairCircle, until, teardown } from '../support/pairRealAgents.js';

// REPRO over REAL public NKN (the browser's other transport). Relay-only passed; this isolates
// whether NKN one-way chat delivery is what silently drops (the both-mode failure mode).
// SKIP by default: needs live public-NKN delivery between two sandbox clients, which is
// unreliable here (seed-pool routing). After the part-1 address fix the "invalid public key"
// error is gone; a residual HI-timeout is NKN delivery flakiness, confirmed on-device (L3).
describe.skip('REPRO — kring chat via the REAL receiver over REAL NKN', () => {
  it('broadcastKringMessage A -> B ingests over NKN', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    const t0 = Date.now();
    await connectAgentsOverNkn(A, B);
    console.log('[repro-nkn] both connected over NKN in', Date.now() - t0, 'ms');
    const paired = await pairCircle(A, B).then(() => true).catch((e) => { console.log('[repro-nkn] pair FAILED:', e?.message); return false; });
    console.log('[repro-nkn] paired:', paired);
    if (!paired) { await teardown(A, B); expect(paired, 'pairing over NKN (if this fails, NKN is unreachable from here)').toBe(true); return; }
    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello over real NKN';
    const r = await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, msgId, text });
    console.log('[repro-nkn] broadcast result:', JSON.stringify(r));
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    console.log('[repro-nkn] B.chatEvents:', JSON.stringify(B.chatEvents), 'heldFor B:', A.agent.heldFor?.(B.pubKey));
    expect(got, 'B ingested the chat over NKN').toBeTruthy();
    await teardown(A, B);
  }, 90_000);
});
