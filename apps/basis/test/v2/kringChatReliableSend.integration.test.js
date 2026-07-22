/**
 * Verification — kring chat SEND now fans through the unified secure-agent
 * reliable path (basis injects `sa.peer.sendTo(..., {guarantee:'hold-forward'})`
 * into the stoop bundle as `reliableSend`; `broadcastKringMessage` uses it).
 *
 * Proves, headlessly (node + shared InternalBus, no network):
 *   1. A drives the REAL kring send op (`broadcastKringMessage`) A→B; the
 *      conforming `kring-chat-message` envelope DELIVERS to B and RECORDS
 *      through B's real receive path (chatMessageInbox → ingestKringMessage).
 *   2. A→(offline B): the message is HELD (hold-forward), then delivered on
 *      B's reconnect presence signal — chat now inherits offline hold-forward.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown, goOffline, goOnline,
} from '../support/pairRealAgents.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';

/** Wire a REAL kring receive stack (inbox → stoop ingest + eventLog) for a node,
 *  and feed it any `kring-chat-message` envelopes the node's default handler saw. */
function makeKringReceive(node) {
  const events = [];
  const inbox = createChatMessageInbox({
    eventLog: { append: (e) => events.push(e) },
    ingest:   (payload, fromPeerAddr) =>
      node.agent.callSkill('stoop', 'ingestKringMessage', { payload, fromPeerAddr }),
    logger:   { warn() {}, info() {}, debug() {} },
  });
  const handler = makeKringChatPeerHandler({ inbox });
  return { events, handler };
}

/** Pump every kring-chat-message envelope currently in node.received through the handler. */
async function drainKring(node, handler) {
  for (const m of node.received) {
    if (m?.payload?.subtype === 'kring-chat-message' && !m._drained) {
      m._drained = true;
      await handler(m.from, m.payload);
    }
  }
}

describe('kring chat send over the unified secure-agent reliable path', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('delivers + records A→B, and HOLDS then delivers A→(offline B)', async () => {
    const t0 = Date.now();
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);

    const groupId = 'peer-circle';
    const { joined } = await pairCircle(A, B, { groupId, name: 'Peer Circle', handle: 'peerbee' });
    expect(joined.ok).toBe(true);

    const Brecv = makeKringReceive(B);

    // ── 1. Online delivery + record ──────────────────────────────────────────
    const t1 = Date.now();
    const msgId = `kring-${groupId}-${Date.now().toString(36)}`;
    const text = `hoi kring vanaf A ${Date.now().toString(36)}`;
    const ts = Date.now();
    const res = await A.agent.callSkill('stoop', 'broadcastKringMessage', { groupId, text, msgId, ts });
    // The reliable fan-out reached B (held or delivered both count as sent).
    expect(res.error, `broadcastKringMessage errored: ${res.error}`).toBeUndefined();
    expect(res.sent, `fan-out reached ≥1 recipient — got ${JSON.stringify(res)}`).toBeGreaterThanOrEqual(1);

    // B receives the kring envelope over the wire, then records it through the REAL inbox.
    const gotEnv = await until(() => B.received.find((m) => m.payload?.msgId === msgId));
    expect(gotEnv, 'B received the kring-chat-message envelope').toBeTruthy();
    expect(gotEnv.payload.subtype).toBe('kring-chat-message');
    expect(gotEnv.payload.text, 'envelope carries top-level text (not body)').toBe(text);

    await drainKring(B, Brecv.handler);
    const rendered = Brecv.events.find((e) => e.id === msgId);
    expect(rendered, 'B rendered the kring message into its eventLog').toBeTruthy();
    expect(rendered.payload.text).toBe(text);
    // Durable record on B's side (the ingest mirror into stoop's itemStore).
    const since = await B.agent.callSkill('stoop', 'getMessagesSince', { groupId, sinceTs: 0 });
    expect(since.items.some((i) => i.msgId === msgId), 'B persisted the kring message').toBe(true);
    const onlineMs = Date.now() - t1;

    // ── 2. Offline hold-forward ──────────────────────────────────────────────
    await goOffline(B);
    const t2 = Date.now();
    const msgId2 = `kring-${groupId}-off-${Date.now().toString(36)}`;
    const text2 = `hoi terwijl B offline is ${Date.now().toString(36)}`;
    const res2 = await A.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId, text: text2, msgId: msgId2, ts: Date.now(),
    });
    expect(res2.error).toBeUndefined();
    expect(res2.sent, 'offline send is HELD (counts as sent, not failed)').toBeGreaterThanOrEqual(1);
    // Not yet delivered while offline.
    expect(B.received.find((m) => m.payload?.msgId === msgId2), 'held, not delivered while offline').toBeFalsy();

    // Reconnect + announce presence → the held envelope flushes to B.
    await goOnline(B, { announceTo: A });
    const gotHeld = await until(() => B.received.find((m) => m.payload?.msgId === msgId2), { timeout: 6000 });
    expect(gotHeld, 'held kring message delivered on B reconnect').toBeTruthy();
    expect(gotHeld.payload.text).toBe(text2);
    await drainKring(B, Brecv.handler);
    expect(Brecv.events.some((e) => e.id === msgId2), 'flushed message rendered on B').toBe(true);
    const holdMs = Date.now() - t2;

    // eslint-disable-next-line no-console
    console.log(`[kring-reliable] boot+pair→online-deliver ${onlineMs}ms · offline-hold→flush ${holdMs}ms · total ${Date.now() - t0}ms`);
  }, 30_000);
});
