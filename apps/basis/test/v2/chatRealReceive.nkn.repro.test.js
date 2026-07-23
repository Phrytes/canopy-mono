import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverNkn, pairCircle, until, teardown } from '../support/pairRealAgents.js';

// GATE over REAL public NKN (the browser's other transport). Relay-only + InternalTransport
// already pass; this proves the SAME real receiver ingests a kring chat over genuine public
// NKN — chat + redeem + HI end-to-end on the mesh, not just in-process.
//
// PATIENCE: NKN has a multi-second cold-start — a freshly-connected peer's presence must
// propagate into the mesh before sends to it land, and the first HI into that window is lost.
// The secure-agent's send path re-announces its HI across that window (createSecureAgent
// `_sendOverRoute`), so the handshake completes once the peer is reachable; the redeem round-trip
// and the chat ingest below simply poll patiently (tens of seconds) rather than racing it. Wall
// clock of a minute or two is expected — NKN is slow.
describe('GATE — kring chat via the REAL receiver over REAL NKN', () => {
  it('broadcastKringMessage A -> B ingests over NKN', async () => {
    // Larger redeem budget to absorb the mesh cold-start on each leg of the round-trip.
    const A = await bootRealAgentNode('A', { redeemTimeoutMs: 45_000 });
    const B = await bootRealAgentNode('B', { redeemTimeoutMs: 45_000 });
    const t0 = Date.now();
    await connectAgentsOverNkn(A, B);
    console.log('[gate-nkn] both connected over NKN in', Date.now() - t0, 'ms');

    const tPair = Date.now();
    await pairCircle(A, B);
    console.log('[gate-nkn] paired over NKN in', Date.now() - tPair, 'ms');

    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello over real NKN';
    const tChat = Date.now();
    const r = await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, msgId, text });
    console.log('[gate-nkn] broadcast result:', JSON.stringify(r));

    // Poll patiently — the chat send rides the already-established handshake, but NKN delivery
    // is still a network hop; give it room.
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 30_000, step: 250 });
    console.log('[gate-nkn] chat ingested in', Date.now() - tChat, 'ms; B.chatEvents:', JSON.stringify(B.chatEvents));
    expect(got, 'B ingested the chat over real NKN').toBeTruthy();

    await teardown(A, B);
  }, 150_000);
});
