/**
 * Stoop SP-13.2.1 — broadcastKringMessage skill.
 *
 * Reuses chat.send to fan a plain-text kring chat-message out to every
 * member of the group (except self).  Mocks chat.send so the test
 * captures the per-recipient envelope shape without needing the full
 * NKN transport plumbing.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  DataPart,
} from '@canopy/core';
import { createNeighborhoodAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

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

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [
      { webid: ANNE,  role: 'member' },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
  });
}

describe('Stoop SP-13.2.1 — broadcastKringMessage', () => {
  it('fans the envelope out to every other member via chat.send', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();

    // Replace the real chat.send (which would try to ship over NKN)
    // with a capturing stub.  Returns ok=true so the skill counts
    // successes correctly.
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage', {
      groupId: 'oosterpoort', text: 'Hoi buurt!', msgId: 'm-1', ts: 1735_000_000_000,
    });

    expect(r.sent).toBe(2);
    expect(r.attempted).toBe(2);
    expect(r.errors).toEqual([]);

    expect(calls).toHaveLength(2);
    const toWebids = calls.map(c => c.toWebid).sort();
    expect(toWebids).toEqual([BOB, CARLA].sort());

    for (const c of calls) {
      expect(c.subtype).toBe('kring-chat-message');
      expect(c.threadId).toBe('oosterpoort');
      expect(c.body).toBe('Hoi buurt!');
      expect(c.extras.circleId).toBe('oosterpoort');
      expect(c.extras.msgId).toBe('m-1');
      expect(c.extras.ts).toBe(1735_000_000_000);
      expect(c.extras.fromActor).toBe(ANNE);
    }
  });

  it('skips the caller (does not echo back to self)', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });

    await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-2' }, BOB);

    // BOB sent it; recipients should be ANNE + CARLA (not BOB).
    expect(calls.map(c => c.toWebid).sort()).toEqual([ANNE, CARLA].sort());
  });

  it('counts per-recipient failures in errors[] but never throws', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    bundle.chat.send = vi.fn(async (args) => {
      if (args.toWebid === BOB) return { ok: false, reason: 'recipient-pubkey-unknown' };
      throw new Error('boom');
    });

    const r = await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'Hi', msgId: 'm-3' });

    expect(r.sent).toBe(0);
    expect(r.attempted).toBe(2);
    expect(r.errors).toHaveLength(2);
    const byWebid = Object.fromEntries(r.errors.map(e => [e.webid, e.reason]));
    expect(byWebid[BOB]).toBe('recipient-pubkey-unknown');
    expect(byWebid[CARLA]).toBe('boom');
  });

  it('rejects empty / whitespace-only text', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: '  ', msgId: 'm' })).toEqual({ error: 'text-required' });
    expect(await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: '', msgId: 'm' })).toEqual({ error: 'text-required' });
  });

  it('rejects missing msgId', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    expect(await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: 'hi' })).toEqual({ error: 'msgId-required' });
  });

  it('trims surrounding whitespace from the body before sending', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    const calls = [];
    bundle.chat.send = vi.fn(async (args) => { calls.push(args); return { ok: true }; });
    await callSkill(bundle.agent, 'broadcastKringMessage',
      { groupId: 'oosterpoort', text: '   Hi buurt!  ', msgId: 'm' });
    expect(calls[0].body).toBe('Hi buurt!');
  });
});
