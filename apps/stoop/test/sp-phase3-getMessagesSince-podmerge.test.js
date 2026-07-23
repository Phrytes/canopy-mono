/**
 * Connectivity Phase 3 (read side) — getMessagesSince MERGES a real shared pod.
 *
 * When the circle is backed by a shared pod, the host injects a
 * `bundle.podReadSince(circleId, {sinceTs, max})` seam that range-queries +
 * unseals the pod's authoritative rows. `getMessagesSince` merges those with
 * the local itemStore mirror, deduped by msgId. Here the "MockPod" is a real
 * `MemoryStorageBackend` seeded with content SEALED via the existing seal
 * resolver (`resolveCircleStorage` p2 group-key) + the `sealedMessageLog` row
 * convention — the exact primitives the live pod path reuses.
 *
 * No `podReadSince` seam wired (a no-pod circle) → local-mirror behaviour,
 * unchanged (covered by sp-epsilon3-getMessagesSince.test.js).
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, MemoryStorageBackend } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  resolveCircleStorage, generateGroupKey,
  writeSealedMessage, readSealedMessagesSince,
} from '@onderling/pod-client';
import { createNeighborhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const CIRCLE = 'oosterpoort';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

/** A bundle whose shared-pod READ seam is a real MemoryStorageBackend + seal resolver. */
async function buildBundleWithPod({ backend, open }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ANNE, peers: [] },
    members: [{ webid: ANNE, role: 'member' }],
    podReadSince: (circleId, q) => readSealedMessagesSince(backend, open, { circleId, ...q }).then((r) => r.items),
  });
}

function env({ msgId, ts, text, fromActor = BOB }) {
  return { subtype: 'kring-chat-message', circleId: CIRCLE, msgId, ts, text, fromActor };
}

describe('Phase 3 — getMessagesSince merges the shared pod (MockPod = MemoryStorageBackend)', () => {
  it('returns the pod range merged with the local mirror, deduped by msgId, ts-ordered', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });

    // Pod holds authoritative history: m1, m2 (shared with local), m3.
    await writeSealedMessage(backend, seal, env({ msgId: 'm1', ts: 1000, text: 'pod-one' }));
    await writeSealedMessage(backend, seal, env({ msgId: 'm2', ts: 2000, text: 'pod-two' }));
    await writeSealedMessage(backend, seal, env({ msgId: 'm3', ts: 3000, text: 'pod-three' }));

    const bundle = await buildBundleWithPod({ backend, open });
    await bundle.offeringMatch.start();

    // Local mirror holds m2 (dup of pod) + m4 (this device's own send, not yet on pod).
    await callSkill(bundle.agent, 'ingestKringMessage', { payload: env({ msgId: 'm2', ts: 2000, text: 'local-two' }), fromPubKey: 'pk' });
    await callSkill(bundle.agent, 'ingestKringMessage', { payload: env({ msgId: 'm4', ts: 4000, text: 'local-four' }), fromPubKey: 'pk' });

    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: CIRCLE, sinceTs: 0 });

    // Union of {m1,m2,m3} (pod) and {m2,m4} (local), deduped by msgId, ts asc.
    expect(r.items.map((i) => i.msgId)).toEqual(['m1', 'm2', 'm3', 'm4']);
    // m2 appears ONCE (deduped) — the local projection wins the dedupe.
    expect(r.items.filter((i) => i.msgId === 'm2')).toHaveLength(1);
    expect(r.items.find((i) => i.msgId === 'm2').text).toBe('local-two');
    // m1/m3 came ONLY from the pod (unsealed).
    expect(r.items.find((i) => i.msgId === 'm1').text).toBe('pod-one');
    expect(r.items.find((i) => i.msgId === 'm3').text).toBe('pod-three');
    expect(r.truncated).toBe(false);
  });

  it('honours sinceTs across the merged set', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    await writeSealedMessage(backend, seal, env({ msgId: 'm1', ts: 1000, text: 'old' }));
    await writeSealedMessage(backend, seal, env({ msgId: 'm2', ts: 5000, text: 'new' }));

    const bundle = await buildBundleWithPod({ backend, open });
    await bundle.offeringMatch.start();

    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: CIRCLE, sinceTs: 2000 });
    expect(r.items.map((i) => i.msgId)).toEqual(['m2']);
  });

  it('a pod read failure falls back to the local mirror (never throws)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighborhoodAgent({
      identity: id, transport: tx,
      offeringMatch: { group: CIRCLE, localActor: ANNE, peers: [] },
      members: [{ webid: ANNE, role: 'member' }],
      podReadSince: async () => { throw new Error('pod-unreachable'); },
    });
    await bundle.offeringMatch.start();
    await callSkill(bundle.agent, 'ingestKringMessage', { payload: env({ msgId: 'm-local', ts: 1000, text: 'still-here' }), fromPubKey: 'pk' });

    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: CIRCLE, sinceTs: 0 });
    expect(r.items.map((i) => i.msgId)).toEqual(['m-local']);
  });
});
