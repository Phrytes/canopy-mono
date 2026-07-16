/**
 * Group-broadcast envelope — Phase 7 step 5.
 *
 * `{type:'group-publish', groupId, topic?, envelope}` lets a sender fan out
 * a single envelope to all currently-known group members in one
 * client→relay frame. Membership is established at register time via
 * `groupProof`; the relay tracks `clientsByGroup` and rejects fan-outs
 * from non-members. Offline members get queued via the same topic-aware
 * buffer as `send` (Phase 7 step 4).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay } from '../src/server.js';
import { AgentIdentity, GroupManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (raw) => {
      try { ws.messages.push(JSON.parse(raw)); } catch {}
    });
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}
function send(ws, obj) { ws.send(JSON.stringify(obj)); }
async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}

describe('startRelay — group-publish (Phase 7 step 5)', () => {
  let admin, alice, bob, charlie, gm;
  let aliceProof, bobProof, charlieProof, otherGroupProof;

  beforeAll(async () => {
    admin   = await AgentIdentity.generate(new VaultMemory());
    alice   = await AgentIdentity.generate(new VaultMemory());
    bob     = await AgentIdentity.generate(new VaultMemory());
    charlie = await AgentIdentity.generate(new VaultMemory());
    gm      = new GroupManager({ identity: admin, vault: new VaultMemory() });
    aliceProof   = await gm.issueProof(alice.pubKey,   'block-42');
    bobProof     = await gm.issueProof(bob.pubKey,     'block-42');
    charlieProof = await gm.issueProof(charlie.pubKey, 'block-42');
    otherGroupProof = await gm.issueProof(charlie.pubKey, 'block-99');
  });

  let relay;
  beforeEach(async () => {
    relay = await startRelay({
      port: 0,
      acceptedGroups: [
        { groupId: 'block-42', adminPubKey: admin.pubKey },
        { groupId: 'block-99', adminPubKey: admin.pubKey },
      ],
      queueCap: 3,
    });
  });
  afterEach(async () => { await relay.stop(); });

  /**
   * Helper: connect + register N members of `block-42`. Resolves to an
   * array of WebSocket objects (with `.messages`) in the same order as
   * the supplied identities.
   */
  async function joinBlock42(identities) {
    const sockets = [];
    for (const id of identities) {
      const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
      const proof = id === alice ? aliceProof
                  : id === bob   ? bobProof
                  : charlieProof;
      send(ws, { type: 'register', address: id.pubKey, groupProof: proof });
      await waitFor(() => ws.messages.some(m => m.type === 'registered'));
      sockets.push(ws);
    }
    return sockets;
  }

  it('fans out to all currently-online group members (sender excluded) and acks back', async () => {
    const [aSocket, bSocket, cSocket] = await joinBlock42([alice, bob, charlie]);
    aSocket.messages.length = 0;
    bSocket.messages.length = 0;
    cSocket.messages.length = 0;

    send(aSocket, {
      type:     'group-publish',
      groupId:  'block-42',
      topic:    'block-42/requests',
      envelope: { _p: 'OW', _topic: 'block-42/requests', payload: { text: 'paint fence' } },
    });

    await waitFor(() =>
      bSocket.messages.some(m => m.type === 'message')
      && cSocket.messages.some(m => m.type === 'message')
      && aSocket.messages.some(m => m.type === 'group-publish-ack'),
    );

    const ack = aSocket.messages.find(m => m.type === 'group-publish-ack');
    expect(ack).toMatchObject({ groupId: 'block-42', delivered: 2, queued: 0 });

    const bDelivered = bSocket.messages.find(m => m.type === 'message');
    const cDelivered = cSocket.messages.find(m => m.type === 'message');
    expect(bDelivered.envelope.payload).toEqual({ text: 'paint fence' });
    expect(cDelivered.envelope.payload).toEqual({ text: 'paint fence' });

    // Sender does NOT receive its own broadcast.
    expect(aSocket.messages.filter(m => m.type === 'message')).toHaveLength(0);

    aSocket.close(); bSocket.close(); cSocket.close();
  });

  it('group-publish targets only currently-connected members; previously-disconnected members are not queued', async () => {
    // Per the resume plan (step 5): "the relay fans out to all
    // currently-connected group members in one client→relay frame".
    // Group membership is dropped on disconnect; previously-registered
    // members who are offline at fan-out time receive nothing — apps
    // wanting durable broadcast to known-offline members should send
    // individually via `publishOneWay` (topic-aware per-addr queue).
    const [aSocket, bSocket, cSocket] = await joinBlock42([alice, bob, charlie]);
    bSocket.close();
    // Wait until the relay's latest peer-list (the one broadcast from
    // bob's disconnect handler) excludes bob. Looking only at the most
    // recent peer-list avoids matching an early registration-time
    // peer-list that pre-dated bob's join.
    await waitFor(() => {
      const peerLists = aSocket.messages.filter(m => m.type === 'peer-list');
      const last = peerLists[peerLists.length - 1];
      return last && !last.peers.includes(bob.pubKey);
    });

    aSocket.messages.length = 0;
    cSocket.messages.length = 0;

    send(aSocket, {
      type:     'group-publish',
      groupId:  'block-42',
      topic:    'block-42/requests',
      envelope: { _p: 'OW', _topic: 'block-42/requests', payload: { n: 1 } },
    });

    await waitFor(() => aSocket.messages.some(m => m.type === 'group-publish-ack'));
    const ack = aSocket.messages.find(m => m.type === 'group-publish-ack');
    // Charlie is online → 1 delivered. Bob disconnected → not in member
    // set → 0 queued (relay's group-publish doesn't track membership
    // beyond connection lifetime).
    expect(ack).toMatchObject({ delivered: 1, queued: 0 });
    expect(cSocket.messages.some(m => m.type === 'message' && m.envelope.payload.n === 1)).toBe(true);

    // Bob reconnects later — receives nothing (the broadcast was lost
    // for him by design; durable broadcast goes through publishOneWay).
    const bSocket2 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bSocket2, { type: 'register', address: bob.pubKey, groupProof: bobProof });
    await waitFor(() => bSocket2.messages.some(m => m.type === 'registered'));
    // Give the relay a tick to flush any queued messages (there should be none).
    await new Promise(r => setTimeout(r, 30));
    expect(bSocket2.messages.filter(m => m.type === 'message')).toHaveLength(0);

    aSocket.close(); cSocket.close(); bSocket2.close();
  });

  it('rejects group-publish from a non-member (different group) with an error frame', async () => {
    const [aSocket] = await joinBlock42([alice]);
    // Charlie registers under block-99 (different group).
    const cSocket = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(cSocket, { type: 'register', address: charlie.pubKey, groupProof: otherGroupProof });
    await waitFor(() => cSocket.messages.some(m => m.type === 'registered'));

    cSocket.messages.length = 0;

    // Charlie tries to fan out to block-42 — should be rejected.
    send(cSocket, {
      type:     'group-publish',
      groupId:  'block-42',
      topic:    'block-42/requests',
      envelope: { _p: 'OW', payload: {} },
    });
    await waitFor(() => cSocket.messages.some(m => m.type === 'error'));
    const err = cSocket.messages.find(m => m.type === 'error');
    expect(err.message).toMatch(/not a member/i);

    // Alice received nothing.
    expect(aSocket.messages.filter(m => m.type === 'message')).toHaveLength(0);

    aSocket.close(); cSocket.close();
  });

  it('rejects group-publish before register', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, {
      type: 'group-publish', groupId: 'block-42', envelope: { _p: 'OW', payload: {} },
    });
    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    const err = ws.messages.find(m => m.type === 'error');
    expect(err.message).toMatch(/register first/i);
    ws.close();
  });

  it('rejects malformed group-publish (missing groupId or envelope)', async () => {
    const [aSocket] = await joinBlock42([alice]);
    aSocket.messages.length = 0;

    send(aSocket, { type: 'group-publish' });
    await waitFor(() => aSocket.messages.some(m => m.type === 'error'));
    expect(aSocket.messages.find(m => m.type === 'error').message)
      .toMatch(/groupId \+ envelope required/i);

    aSocket.close();
  });

  it('topic field flows through onto the delivered envelope when set', async () => {
    const [aSocket, bSocket] = await joinBlock42([alice, bob]);
    aSocket.messages.length = 0;
    bSocket.messages.length = 0;

    send(aSocket, {
      type:     'group-publish',
      groupId:  'block-42',
      topic:    'paint-fence',
      envelope: { _p: 'OW', _topic: 'paint-fence', payload: { kind: 'paint' } },
    });

    await waitFor(() => bSocket.messages.some(m => m.type === 'message'));
    const delivered = bSocket.messages.find(m => m.type === 'message');
    expect(delivered.envelope._topic).toBe('paint-fence');
    expect(delivered.envelope.payload).toEqual({ kind: 'paint' });

    aSocket.close(); bSocket.close();
  });
});
