/**
 * Stoop V1 — Phase 18 tests.
 *
 * UsageMetrics integration: the factory wires a `UsageMetrics` instance
 * onto the bundle, key skill handlers + wireChat call `metrics.record`
 * on user actions, and a `getMetrics` skill exposes a read-only
 * snapshot for the closed-beta dashboard.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  DataPart,
} from '@canopy/core';

import { createNeighborhoodAgent } from '../src/index.js';
import { UsageMetrics } from '../src/lib/UsageMetrics.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildAgent({ metrics } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }, { webid: BOB }],
    metrics,
  });
  await bundle.skillMatch.start();
  return bundle;
}

describe('Stoop V1 Phase 18 — UsageMetrics on the bundle', () => {
  it('factory wires a UsageMetrics by default', async () => {
    const bundle = await buildAgent();
    expect(bundle.metrics).toBeTruthy();
    expect(typeof bundle.metrics.snapshot).toBe('function');
    expect(bundle.metrics.snapshot()).toEqual({});
  });

  it('caller-supplied metrics override is honoured', async () => {
    const m = new UsageMetrics();
    const bundle = await buildAgent({ metrics: m });
    expect(bundle.metrics).toBe(m);
  });
});

describe('Stoop V1 Phase 18 — record() fires on key user actions', () => {
  it('postRequest records post-<kind>', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'paint fence', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    await callSkill(bundle.agent, 'postRequest',
      { text: 'lend ladder', kind: 'lend', expectClaims: 0, timeoutMs: 1 });
    const snap = bundle.metrics.snapshot();
    expect(snap['post-ask']?.count).toBe(1);
    expect(snap['post-lend']?.count).toBe(1);
  });

  it('reportPost + mutePeer + cancelRequest all record', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'postRequest',
      { text: 'foo', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    await callSkill(bundle.agent, 'reportPost',
      { itemId: r.requestId, reason: 'spam' });
    await callSkill(bundle.agent, 'mutePeer', { peerWebid: BOB });
    await callSkill(bundle.agent, 'cancelRequest', { requestId: r.requestId });
    const snap = bundle.metrics.snapshot();
    expect(snap['report-post']?.count).toBe(1);
    expect(snap['mute-peer']?.count).toBe(1);
    expect(snap['cancel-request']?.count).toBe(1);
  });

  it('encryptedBackup records backup-created', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'encryptedBackup', { passphrase: 'hunter2' });
    expect(bundle.metrics.snapshot()['backup-created']?.count).toBe(1);
  });
});

describe('Stoop V1 Phase 18 — getMetrics skill', () => {
  it('returns the live snapshot', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'x', kind: 'offer', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'getMetrics');
    expect(r.snapshot['post-offer']?.count).toBe(1);
    expect(typeof r.capturedAt).toBe('number');
  });

  it('snapshot is a read-only copy (mutating it doesnt affect counters)', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'y', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'getMetrics');
    r.snapshot['post-ask'].count = 999;
    const r2 = await callSkill(bundle.agent, 'getMetrics');
    expect(r2.snapshot['post-ask'].count).toBe(1);
  });
});
