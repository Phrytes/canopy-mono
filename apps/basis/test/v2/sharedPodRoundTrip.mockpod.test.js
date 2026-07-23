/**
 * Connectivity Phase 3 (KEYSTONE) — end-to-end shared-pod round-trip against a MockPod.
 *
 * The "MockPod" is a real `MemoryStorageBackend` (@onderling/core) — the BLIND
 * ciphertext store the StorageBackend port documents as the reference adapter.
 * Two logical peers share ONE backend; content is SEALED above it via the
 * EXISTING seal resolver (`resolveCircleStorage` p2 group-key) and laid out under
 * the range-queryable row convention (`sealedMessageLog`). Nothing here invents a
 * sealing scheme — it wires the primitives that already exist.
 *
 * It proves all three data-move branches actually write + read the pod:
 *
 *   pod-signal  A seals+writes the pod, fans a REF envelope → B receives the ref,
 *               resolves it against the pod (StorageBackend.get + unseal), ingests
 *               → asserts B.chatEvents shows the FULL message.
 *   pod-only    A seals+writes the pod, fans NOTHING → B never receives a fan, yet
 *               reads the message via getMessagesSince (its podReadSince seam).
 *   no-pod      no data-policy → fan-out-full (full-body envelope), pod UNTOUCHED
 *               (behaviour unchanged) → B ingests inline.
 *
 * The sender is a REAL stoop `createNeighborhoodAgent` (real `broadcastKringMessage`
 * → `broadcastToCircle` → the podWrite seam + ref-fan). The receiver is the REAL
 * basis `chatMessageInbox` (real ref-resolution + eventLog append). The pod row is
 * asserted to hold SEALED bytes — never plaintext.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, MemoryStorageBackend } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  resolveCircleStorage, generateGroupKey, isSealed,
  writeSealedMessage, readSealedMessage, readSealedMessagesSince,
} from '@onderling/pod-client';
import { createNeighborhoodAgent } from '@onderling-app/stoop';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { EventLog } from '../../src/eventLog.js';

const ANNE = 'https://id.example/anne';   // sender A
const BOB  = 'https://id.example/bob';    // receiver B
const CIRCLE = 'peer-circle';
const QUIET = { warn() {}, info() {}, debug() {} };

async function callSkill(agent, id, args, from = ANNE) {
  const def = agent.skills.get(id);
  if (!def) throw new Error(`no such skill: ${id}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

/** Sender A: a real stoop bundle whose pod seam SEALS+WRITES the shared MockPod and whose reliable fan
 *  is captured (the transport stand-in — delivery to B is driven explicitly, in-process). */
async function bootSenderA({ backend, seal, circleDataMove, deliver }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ANNE, peers: [] },
    members: [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }],
    circleDataMove,
    podWrite: (circleId, env) => writeSealedMessage(backend, seal, env).then((ref) => ({ ref })),
    reliableSend: async (addr, envelope) => { deliver(addr, envelope); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/** Receiver B (live render path): the REAL basis inbox with a pod ref-resolver over the shared MockPod. */
function bootReceiverB({ backend, open }) {
  const eventLog = new EventLog({ initial: [], muted: [] });
  const inbox = createChatMessageInbox({
    eventLog,
    resolveRef: (refEnv) => readSealedMessage(backend, open, refEnv.ref),
    logger: QUIET,
  });
  return { eventLog, inbox, get chatEvents() { return eventLog.query({ excludeMuted: true }); } };
}

/** Receiver B (durable / catch-up path): a real stoop bundle whose read seam range-queries the shared MockPod. */
async function bootReaderBStoop({ backend, open }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: BOB, peers: [] },
    members: [{ webid: BOB, role: 'member' }],
    podReadSince: (circleId, q) => readSealedMessagesSince(backend, open, { circleId, ...q }).then((r) => r.items),
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('Phase 3 KEYSTONE — shared-pod round-trip (MockPod = MemoryStorageBackend)', () => {
  it('pod-signal: A seals+writes the pod + fans a REF → B resolves it from the pod + ingests', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const delivered = [];
    const A = await bootSenderA({ backend, seal, circleDataMove: () => 'pod-signal', deliver: (addr, env) => delivered.push({ addr, env }) });
    const B = bootReceiverB({ backend, open });

    const r = await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'hoi via de pod', msgId: 'm1', ts: Date.now() });

    // A really wrote the pod + fanned a ref (not a full-body degrade).
    expect(r.podSignal).toBe(true);
    expect(r.sent).toBe(1);
    expect(backend.size).toBe(1);
    // The pod row holds SEALED bytes — never the plaintext.
    const raw = await backend.get(r.ref);
    expect(isSealed(raw)).toBe(true);
    expect(raw.includes('hoi via de pod')).toBe(false);
    // The fanned wire envelope is a REF envelope: has ref, no text.
    expect(delivered).toHaveLength(1);
    const wire = delivered[0].env;
    expect(wire.ref).toBe(r.ref);
    expect(wire.text).toBeUndefined();
    expect(wire.subtype).toBe('kring-chat-message');

    // B receives the ref → resolves from the pod → ingests the FULL message.
    const verdict = await B.inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: ANNE });
    expect(verdict.result).toBe('inserted');
    const evt = B.chatEvents.find((e) => e.id === 'm1');
    expect(evt).toBeTruthy();
    expect(evt.payload.text).toBe('hoi via de pod');
  });

  it('pod-signal: a duplicate ref is deduped WITHOUT a second pod read', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const delivered = [];
    const A = await bootSenderA({ backend, seal, circleDataMove: () => 'pod-signal', deliver: (addr, env) => delivered.push({ env }) });
    let reads = 0;
    const eventLog = new EventLog({ initial: [], muted: [] });
    const inbox = createChatMessageInbox({
      eventLog,
      resolveRef: (refEnv) => { reads += 1; return readSealedMessage(backend, open, refEnv.ref); },
      logger: QUIET,
    });

    await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'eenmalig', msgId: 'dup', ts: Date.now() });
    const wire = delivered[0].env;
    const first = await inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: ANNE });
    const second = await inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: ANNE });
    expect(first.result).toBe('inserted');
    expect(second.result).toBe('deduped');
    expect(reads).toBe(1);   // the duplicate never hit the pod
  });

  it('pod-only: A seals+writes the pod + fans NOTHING → B reads it via getMessagesSince', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const delivered = [];
    const A = await bootSenderA({ backend, seal, circleDataMove: () => 'pod-only', deliver: (addr, env) => delivered.push({ env }) });

    const r = await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'stil in de pod', msgId: 'm2', ts: 2000 });

    expect(r.podOnly).toBe(true);
    expect(r.sent).toBe(0);
    expect(delivered).toHaveLength(0);   // no fan
    expect(backend.size).toBe(1);

    // B never received a fan — it reads the message straight off the shared pod.
    const B = await bootReaderBStoop({ backend, open });
    const since = await callSkill(B.agent, 'getMessagesSince', { groupId: CIRCLE, sinceTs: 0 }, BOB);
    const got = since.items.find((i) => i.msgId === 'm2');
    expect(got).toBeTruthy();
    expect(got.text).toBe('stil in de pod');
  });

  it('no-pod: fan-out-full carries the body inline; the pod is UNTOUCHED (behaviour unchanged)', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const delivered = [];
    // No circleDataMove wired → the default fan-out-full path.
    const A = await bootSenderA({ backend, seal, circleDataMove: undefined, deliver: (addr, env) => delivered.push({ env }) });
    const B = bootReceiverB({ backend, open });

    const r = await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'geen pod', msgId: 'm3', ts: Date.now() });

    expect(r.podSignal).toBeUndefined();
    expect(r.podOnly).toBeUndefined();
    expect(r.sent).toBe(1);
    expect(backend.size).toBe(0);   // pod never written on the no-pod path

    const wire = delivered[0].env;
    expect(wire.text).toBe('geen pod');   // full-body envelope, no ref
    expect(wire.ref).toBeUndefined();

    const verdict = await B.inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: ANNE });
    expect(verdict.result).toBe('inserted');
    expect(B.chatEvents.find((e) => e.id === 'm3').payload.text).toBe('geen pod');
  });

  it('receiver resilience: a ref whose pod row is missing is SKIPPED, never crashes the loop', async () => {
    const backend = new MemoryStorageBackend();
    const { open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const B = bootReceiverB({ backend, open });
    const danglingRef = { type: 'p2p-chat', subtype: 'kring-chat-message', circleId: CIRCLE, msgId: 'ghost', ts: 1, ref: `${CIRCLE}/0000000000000001-ghost`, fromActor: ANNE };
    const verdict = await B.inbox.ingestChatMessage(danglingRef, { source: 'receiver', fromPeerAddr: ANNE });
    expect(verdict.result).toBe('deferred');
    expect(B.chatEvents).toHaveLength(0);
  });
});
