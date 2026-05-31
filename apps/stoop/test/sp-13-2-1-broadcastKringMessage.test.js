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

  /* ── Hybrid: local mirror writes to itemStore so the sender's own
   *           chat persists across reloads + appears in the same
   *           kring-chat history the receiver reads from. ── */

  it('writes the outgoing chat to itemStore as a kring-chat-message item', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    bundle.chat.send = vi.fn(async () => ({ ok: true }));
    const r = await callSkill(bundle.agent, 'broadcastKringMessage', {
      groupId: 'oosterpoort', text: 'Hoi buurt!', msgId: 'm-local-1', ts: 1735_000_000_000,
    });
    expect(r.itemId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.itemId);
    expect(item.type).toBe('kring-chat-message');
    expect(item.text).toBe('Hoi buurt!');
    expect(item.source.circleId).toBe('oosterpoort');
    expect(item.source.msgId).toBe('m-local-1');
    expect(item.source.ts).toBe(1735_000_000_000);
    expect(item.source.from).toBe(ANNE);
  });

  it('deduplicates the local mirror by msgId across resends', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    bundle.chat.send = vi.fn(async () => ({ ok: true }));
    const r1 = await callSkill(bundle.agent, 'broadcastKringMessage', {
      groupId: 'oosterpoort', text: 'first', msgId: 'dup-id',
    });
    const r2 = await callSkill(bundle.agent, 'broadcastKringMessage', {
      groupId: 'oosterpoort', text: 'second', msgId: 'dup-id',
    });
    expect(r2.itemId).toBe(r1.itemId);
    const open = await bundle.itemStore.listOpen({ type: 'kring-chat-message' });
    expect(open).toHaveLength(1);
  });
});

describe('Stoop SP-13.2.1 — ingestKringMessage', () => {
  it('mirrors a remote envelope to itemStore as a kring-chat-message item', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    const r = await callSkill(bundle.agent, 'ingestKringMessage', {
      payload: {
        subtype: 'kring-chat-message',
        circleId: 'oosterpoort', msgId: 'rm-1',
        text: 'Hoi buurt!', ts: 1735_000_000_000,
        fromActor: BOB, fromWebid: BOB,
      },
      fromPubKey: 'pk-bob-stableid',
      fromNknAddr: 'nkn-addr-bob',
    });
    expect(r.ok).toBe(true);
    const item = await bundle.itemStore.getById(r.itemId);
    expect(item.type).toBe('kring-chat-message');
    expect(item.text).toBe('Hoi buurt!');
    expect(item.source.circleId).toBe('oosterpoort');
    expect(item.source.msgId).toBe('rm-1');
    expect(item.source.fromActor).toBe(BOB);
    expect(item.source.fromPubKey).toBe('pk-bob-stableid');
    expect(item.source.fromNknAddr).toBe('nkn-addr-bob');
  });

  it('dedupes by msgId on resend (idempotent ingest)', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    const payload = {
      subtype: 'kring-chat-message',
      circleId: 'oosterpoort', msgId: 'dedup-1',
      text: 'Hi', ts: 1, fromActor: BOB,
    };
    const r1 = await callSkill(bundle.agent, 'ingestKringMessage', { payload, fromPubKey: 'pk-bob' });
    const r2 = await callSkill(bundle.agent, 'ingestKringMessage', { payload, fromPubKey: 'pk-bob' });
    expect(r1.ok).toBe(true);
    expect(r2.deduped).toBe(true);
    const open = await bundle.itemStore.listOpen({ type: 'kring-chat-message' });
    expect(open).toHaveLength(1);
  });

  it('drops chats from peers muted via mutePeer skill', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    // Mute BOB via the regular skill (mirrors how a user would do it
    // from the UI; populates the same internal muted Set).
    await callSkill(bundle.agent, 'mutePeer', { peerWebid: BOB });
    // mutePeer resolves BOB → 'sid-bob' via MemberMap, so the muted
    // set is keyed by stableId.  Mirror the wire shape chat.send
    // produces: include fromStableId so the receiver's check hits.
    const r = await callSkill(bundle.agent, 'ingestKringMessage', {
      payload: {
        subtype: 'kring-chat-message',
        circleId: 'oosterpoort', msgId: 'mute-1',
        text: 'Hi', ts: 1, fromActor: BOB, fromWebid: BOB,
        fromStableId: 'sid-bob',
      },
      fromPubKey: 'pk-bob',
    });
    expect(r.muted).toBe(true);
    const open = await bundle.itemStore.listOpen({ type: 'kring-chat-message' });
    expect(open).toHaveLength(0);
  });

  it('rejects malformed payloads', async () => {
    const bundle = await buildBundle();
    await bundle.skillMatch.start();
    expect(await callSkill(bundle.agent, 'ingestKringMessage', {})).toEqual({ error: 'payload required' });
    expect(await callSkill(bundle.agent, 'ingestKringMessage',
      { payload: { msgId: 'x', text: 't', ts: 1 } })).toEqual({ error: 'circleId required' });
    expect(await callSkill(bundle.agent, 'ingestKringMessage',
      { payload: { circleId: 'g', text: 't', ts: 1 } })).toEqual({ error: 'msgId required' });
    expect(await callSkill(bundle.agent, 'ingestKringMessage',
      { payload: { circleId: 'g', msgId: 'x', ts: 1 } })).toEqual({ error: 'text required' });
  });
});
