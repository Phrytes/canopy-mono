/**
 * Connectivity Phase 3 (LIVE KEYS) — the shared-pod round-trip proven with REAL circle group-key
 * custody, mock STORAGE. This is the stronger sibling of `sharedPodRoundTrip.mockpod.test.js`: that
 * one sourced its {seal,open} from `resolveCircleStorage({posture:'p2', groupKey: generateGroupKey()})`
 * — a hand-generated key. HERE the seal/open come from the ACTUAL member-side key path a real circle
 * uses: a `createCirclePodProducer` (p2) bootstraps a per-circle control agent that holds the
 * recipient-wrapped group key, and THIS device's per-circle X25519 sealing identity unwraps it via
 * `controlAgent.sealingStrategy(privateKey)`. That is exactly what `circleApp.getCircleSealStrategy`
 * feeds into the `podWrite`/`podReadSince`/`resolveRef` closures this pass wires.
 *
 * The "MockPod" (the sealed row store) is a real `MemoryStorageBackend` — the same blind ciphertext
 * store the keystone uses. Only the KEY MATERIAL is upgraded to the live circle path; the storage stays
 * mocked (a real Solid backend is the on-device/L3 check). We prove:
 *
 *   pod-signal  A seals+writes the pod under the LIVE group key, fans a REF → B resolves it (read row +
 *               unseal with the live opener) and ingests the full message. The pod row is asserted SEALED
 *               (never plaintext).
 *   pod-only    A seals+writes, fans NOTHING → a reader B range-queries the pod via getMessagesSince
 *               (its podReadSince seam over the live opener).
 *   non-member  an OUTSIDER key (never wrapped into the group key) cannot resolve a strategy AND cannot
 *               open the sealed row with a wrong group key — no silent plaintext.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, MemoryStorageBackend } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  isSealed, generateKeypair, generateGroupKey, groupKeyStrategy,
  writeSealedMessage, readSealedMessage, readSealedMessagesSince,
} from '@onderling/pod-client';
import { PodClient } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createNeighborhoodAgent } from '@onderling-app/stoop';
import { createCirclePodProducer } from '../../src/v2/circlePodProducer.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { EventLog } from '../../src/eventLog.js';

const ANNE = 'https://id.example/anne';   // sender A
const BOB  = 'https://id.example/bob';    // receiver B
const CIRCLE = 'live-key-kring';
const QUIET = { warn() {}, info() {}, debug() {} };

/** An in-memory vault for the producer (holds its sealing identity + controller key). */
class MemVault {
  #m = new Map();
  async get(k) { return this.#m.get(k); }
  async set(k, v) { this.#m.set(k, String(v)); }
  async delete(k) { this.#m.delete(k); }
  async has(k) { return this.#m.has(k); }
}

/** The per-circle pod-client factory the web host injects — an in-memory pseudo-pod for the producer's
 *  OWN key resource (distinct from the shared MockPod that holds the sealed chat rows). */
function makePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/** Stand up a REAL p2 circle producer + resolve THIS device's live {seal,open} from its control agent. */
async function liveCircleSealOpen(circleId) {
  const vault = new MemVault();
  const producer = await createCirclePodProducer({
    circleId, storagePosture: 'p2', vault, generateKeypair, makePodClient,
  });
  const idKey = await producer.sealingIdentity.ensure();
  const strategy = await producer.controlAgent.sealingStrategy(idKey.privateKey);   // LIVE group-key seal/open
  return { producer, strategy };
}

/** Sender A: a real stoop bundle whose podWrite SEALS+WRITES the shared MockPod under the LIVE seal. */
async function bootSenderA({ backend, seal, circleDataMove, deliver }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ANNE, peers: [] },
    members: [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }],
    circleDataMove,
    podWrite: (cid, env) => writeSealedMessage(backend, seal, env).then((ref) => ({ ref })),
    reliableSend: async (addr, envelope) => { deliver(addr, envelope); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/** Receiver B (live render path): the real basis inbox whose resolveRef opens the row with the LIVE opener. */
function bootReceiverB({ backend, open }) {
  const eventLog = new EventLog({ initial: [], muted: [] });
  const inbox = createChatMessageInbox({
    eventLog,
    resolveRef: (refEnv) => readSealedMessage(backend, open, refEnv.ref),
    logger: QUIET,
  });
  return { eventLog, inbox, get chatEvents() { return eventLog.query({ excludeMuted: true }); } };
}

/** Reader B (durable / catch-up path): a real stoop bundle whose podReadSince range-queries the MockPod. */
async function bootReaderBStoop({ backend, open }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: BOB, peers: [] },
    members: [{ webid: BOB, role: 'member' }],
    podReadSince: (cid, q) => readSealedMessagesSince(backend, open, { circleId: cid, ...q }).then((r) => r.items),
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, id, args, from = ANNE) {
  const def = agent.skills.get(id);
  if (!def) throw new Error(`no such skill: ${id}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

describe('Phase 3 (LIVE KEYS) — shared-pod round-trip with REAL circle group-key custody', () => {
  it('pod-signal: A seals+writes under the LIVE group key + fans a REF → B opens it with the live opener', async () => {
    const backend = new MemoryStorageBackend();
    const { strategy } = await liveCircleSealOpen(CIRCLE);
    const delivered = [];
    const A = await bootSenderA({ backend, seal: strategy.seal, circleDataMove: () => 'pod-signal', deliver: (addr, env) => delivered.push({ env }) });
    const B = bootReceiverB({ backend, open: strategy.open });

    const r = await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'hoi via de echte sleutel', msgId: 'lk1', ts: Date.now() });

    // A really wrote the pod + fanned a ref (not a full-body degrade).
    expect(r.podSignal).toBe(true);
    expect(r.sent).toBe(1);
    expect(backend.size).toBe(1);
    // The pod row holds SEALED bytes — never the plaintext.
    const raw = await backend.get(r.ref);
    expect(isSealed(raw)).toBe(true);
    expect(raw.includes('hoi via de echte sleutel')).toBe(false);
    // The fanned wire envelope is a REF envelope: has ref, no text.
    const wire = delivered[0].env;
    expect(wire.ref).toBe(r.ref);
    expect(wire.text).toBeUndefined();

    // B resolves the ref from the pod (with the LIVE opener) → ingests the full message.
    const verdict = await B.inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: ANNE });
    expect(verdict.result).toBe('inserted');
    expect(B.chatEvents.find((e) => e.id === 'lk1').payload.text).toBe('hoi via de echte sleutel');
  });

  it('pod-only: A seals+writes under the LIVE key + fans NOTHING → B reads it via getMessagesSince', async () => {
    const backend = new MemoryStorageBackend();
    const { strategy } = await liveCircleSealOpen(CIRCLE);
    const delivered = [];
    const A = await bootSenderA({ backend, seal: strategy.seal, circleDataMove: () => 'pod-only', deliver: (addr, env) => delivered.push({ env }) });

    const r = await callSkill(A.agent, 'broadcastKringMessage', { groupId: CIRCLE, text: 'stil, echt gesealed', msgId: 'lk2', ts: 4200 });
    expect(r.podOnly).toBe(true);
    expect(r.sent).toBe(0);
    expect(delivered).toHaveLength(0);
    expect(backend.size).toBe(1);

    const B = await bootReaderBStoop({ backend, open: strategy.open });
    const since = await callSkill(B.agent, 'getMessagesSince', { groupId: CIRCLE, sinceTs: 0 }, BOB);
    const got = since.items.find((i) => i.msgId === 'lk2');
    expect(got).toBeTruthy();
    expect(got.text).toBe('stil, echt gesealed');
  });

  it('non-member: an outsider key resolves NO strategy AND cannot open the sealed row (no silent plaintext)', async () => {
    const backend = new MemoryStorageBackend();
    const { producer, strategy } = await liveCircleSealOpen(CIRCLE);

    // A member seals + writes one row under the live group key.
    const ref = await writeSealedMessage(backend, strategy.seal, { circleId: CIRCLE, msgId: 'lk3', ts: 9000, text: 'alleen voor leden', subtype: 'kring-chat-message' });
    expect(isSealed(await backend.get(ref))).toBe(true);

    // An OUTSIDER (never wrapped into the group key): the membership gate rejects — no strategy at all.
    const outsider = generateKeypair();
    await expect(producer.controlAgent.sealingStrategy(outsider.privateKey)).rejects.toThrow();

    // …and even wielding a (valid but WRONG) group key, the outsider cannot open the row → no plaintext leaks.
    const wrongOpen = groupKeyStrategy({ groupKey: generateGroupKey() }).open;
    await expect(readSealedMessage(backend, wrongOpen, ref)).rejects.toThrow();

    // The rightful member still opens it with the live opener.
    const opened = await readSealedMessage(backend, strategy.open, ref);
    expect(opened.text).toBe('alleen voor leden');
  });
});
