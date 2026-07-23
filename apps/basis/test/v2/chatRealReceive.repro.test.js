import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from '../support/pairRealAgents.js';

// REPRO: does a kring chat fanned via the real broadcastKringMessage get INGESTED by the
// REAL kringChatReceiver (now wired into the harness) — not the old defaultHandler stub?
describe('REPRO — kring chat via the REAL receiver (InternalTransport)', () => {
  it('broadcastKringMessage A -> B ingests via the real kringChatReceiver', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B);
    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello via the real receiver';
    const r = await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, msgId, text });
    console.log('[repro] broadcast result:', JSON.stringify(r));
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 3000 });
    console.log('[repro] B.chatEvents:', JSON.stringify(B.chatEvents));
    console.log('[repro] B.received (stub subtypes):', JSON.stringify(B.received.map((x) => x?.payload?.subtype)));
    expect(got, 'B ingested the chat via the REAL kringChatReceiver').toBeTruthy();
    await teardown(A, B);
  });
});
