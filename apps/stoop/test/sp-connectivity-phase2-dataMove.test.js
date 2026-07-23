/**
 * Connectivity Phase 2 (G1/G2) — the data-move branch on the circle fan.
 *
 * The circle send path (`broadcastToCircle`) now consults the circle's
 * data-policy — the host-injected `bundle.circleDataMove(circleId)` decision
 * derived (in basis) from `policy.pod` via `circleDataPolicy.circleDataMove` —
 * and branches:
 *
 *   - `fan-out-full`          → today's behaviour, unchanged (envelope carries data).
 *   - `pod-signal`/`pod-only` → a real shared pod would be written + a ref fanned;
 *                               the pod side is Phase 3 (getMessagesSince is still a
 *                               stub). Until then these DEGRADE to fan-out-full —
 *                               EXPLICITLY and loudly logged, never silently — so the
 *                               message still reaches every member.
 *
 * These tests pin: no-pod fans full (baseline); a shared/hybrid circle selects
 * pod-signal and (with no real pod) degrades to fan-out-full WITH the log; and
 * delivery still succeeds in every case.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

/** A neighborhood bundle with an optional host-injected data-move resolver + pod writer. */
async function buildBundle({ circleDataMove, podWrite } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members: [
      { webid: ANNE,  role: 'member' },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
    circleDataMove,
    podWrite,
  });
}

describe('Stoop connectivity Phase 2 (G1/G2) — data-move branch', () => {
  let infoSpy;
  beforeEach(() => { infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { infoSpy.mockRestore(); });

  it('no-pod circle (no resolver) → fan-out-full: fans to every other member, no degrade log', async () => {
    const bundle = await buildBundle();               // no circleDataMove wired → default fan-out-full
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (a) => { calls.push(a); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hoi buurt!', msgId: 'm-nopod', ts: 1 });

    expect(r.sent).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.errors).toEqual([]);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([BOB, CARLA].sort());
    // no data-policy degrade line was logged
    const degradeLogged = infoSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('data-policy'));
    expect(degradeLogged).toBe(false);
  });

  it('a resolver returning fan-out-full also fans full with no degrade log', async () => {
    const bundle = await buildBundle({ circleDataMove: () => 'fan-out-full' });
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (a) => { calls.push(a); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-full', ts: 1 });

    expect(r.sent).toBe(2);
    expect(infoSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('data-policy'))).toBe(false);
  });

  it('shared/hybrid circle → pod-signal DEGRADES to fan-out-full WITH the log; delivery still succeeds', async () => {
    // shared/hybrid → circleDataMove resolves 'pod-signal' (basis derives this from policy.pod).
    const bundle = await buildBundle({ circleDataMove: () => 'pod-signal' });
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (a) => { calls.push(a); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hoi buurt!', msgId: 'm-signal', ts: 1 });

    // degrade is honest: the message STILL fans out full to every member.
    expect(r.sent).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.errors).toEqual([]);
    expect(calls.map((c) => c.toWebid).sort()).toEqual([BOB, CARLA].sort());

    // ...and the degrade is EXPLICIT + logged (not silent).
    const line = infoSpy.mock.calls.map(([m]) => m).find((m) => typeof m === 'string' && m.includes('selected pod-signal'));
    expect(line).toBeTruthy();
    expect(line).toContain('oosterpoort');
    expect(line).toContain('degrading to fan-out-full');
  });

  it('pod-only circle DEGRADES to fan-out-full WITH the log (so the message is never lost)', async () => {
    const bundle = await buildBundle({ circleDataMove: () => 'pod-only' });
    await bundle.offeringMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (a) => { calls.push(a); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-only', ts: 1 });

    expect(r.sent).toBe(2);
    expect(calls).toHaveLength(2);
    const line = infoSpy.mock.calls.map(([m]) => m).find((m) => typeof m === 'string' && m.includes('selected pod-only'));
    expect(line).toBeTruthy();
    expect(line).toContain('degrading to fan-out-full');
  });

  it('an ASYNC resolver returning pod-signal degrades the same way', async () => {
    const bundle = await buildBundle({ circleDataMove: async () => 'pod-signal' });
    await bundle.offeringMatch.start();
    bundle.chat.send = vi.fn(async () => ({ ok: true }));

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-async', ts: 1 });

    expect(r.sent).toBe(2);
    expect(infoSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('selected pod-signal'))).toBe(true);
  });

  it('a throwing / unknown resolver falls back to fan-out-full (delivery never breaks)', async () => {
    const boom  = await buildBundle({ circleDataMove: () => { throw new Error('policy-source-down'); } });
    const junk  = await buildBundle({ circleDataMove: () => 'not-a-branch' });
    for (const bundle of [boom, junk]) {
      await bundle.offeringMatch.start();
      bundle.chat.send = vi.fn(async () => ({ ok: true }));
      const r = await callSkill(bundle.agent, 'broadcastKringMessage',
        { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-fallback', ts: 1 });
      expect(r.sent).toBe(2);
    }
    expect(infoSpy.mock.calls.some(([m]) => typeof m === 'string' && m.includes('data-policy'))).toBe(false);
  });

  it('the Phase-3 podWrite seam is honoured: a wired podWrite still degrades (ref-fan is Phase 3) and delivers', async () => {
    const podWrite = vi.fn(async () => ({ ref: 'urn:pod:row:1' }));
    const bundle = await buildBundle({ circleDataMove: () => 'pod-signal', podWrite });
    await bundle.offeringMatch.start();
    bundle.chat.send = vi.fn(async () => ({ ok: true }));

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-seam', ts: 1 });

    // Phase 2 owns the BRANCH only; the ref-fan is Phase 3, so even a wired
    // podWrite degrades to the honest full fan (message still delivered).
    expect(r.sent).toBe(2);
    const line = infoSpy.mock.calls.map(([m]) => m).find((m) => typeof m === 'string' && m.includes('podWrite wired'));
    expect(line).toBeTruthy();
  });
});
