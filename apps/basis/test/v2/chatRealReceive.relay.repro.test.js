import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown } from '../support/pairRealAgents.js';

// REPRO over a REAL relay (running on :8787) via connectPeerTransport — the browser's path.
// InternalTransport passes; if this FAILS, it's the transport-specific bug the browser hit.
const RELAY = process.env.PEER_TEST_RELAY || 'ws://127.0.0.1:8787';

describe('REPRO — kring chat via the REAL receiver over a REAL relay', () => {
  it('broadcastKringMessage A -> B ingests over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const B = await bootRealAgentNode('B');
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello over the real relay';
    const r = await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, msgId, text });
    console.log('[repro-relay] broadcast result:', JSON.stringify(r));
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 6000 });
    console.log('[repro-relay] B.chatEvents:', JSON.stringify(B.chatEvents));
    console.log('[repro-relay] B.received (stub subtypes):', JSON.stringify(B.received.map((x) => x?.payload?.subtype)));
    expect(got, 'B ingested the chat over the relay').toBeTruthy();
    await teardown(A, B);
  });
});
