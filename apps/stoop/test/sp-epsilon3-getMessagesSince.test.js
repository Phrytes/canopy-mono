/**
 * Stoop ε.3 (basis v2 Phase 9) — getMessagesSince skill.
 *
 * Pod range-query entry point for catch-up.  Reads kring-chat-message
 * items from itemStore (same store the rehydrator + ingestKringMessage
 * use), filters by `ts >= sinceTs`, and reshapes each item into the
 * broadcast envelope shape so callers can feed results straight through
 * the ε.1 chatMessageInbox with `source: 'pod'`.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

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

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE, role: 'member' }],
  });
}

/** Seed kring chats via the existing ingest skill (mirrors how the
 *  receiver path actually populates the store, so we exercise the
 *  real item shape getMessagesSince has to read). */
async function seedChats(bundle, chats) {
  for (const c of chats) {
    await callSkill(bundle.agent, 'ingestKringMessage', {
      payload: {
        subtype:   'kring-chat-message',
        circleId:  c.circleId,
        msgId:     c.msgId,
        text:      c.text,
        ts:        c.ts,
        fromActor: c.fromActor ?? BOB,
        ...(c.media ? { media: c.media } : {}),
      },
      fromPubKey: c.fromPubKey ?? 'pk-fake',
    });
  }
}

describe('Stoop ε.3 — getMessagesSince', () => {
  it('returns {items: [], truncated: false} on an empty store', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: 'g1' });
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('returns every matching envelope in ts asc order when all messages are after sinceTs', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'first',  ts: 100 },
      { circleId: 'g1', msgId: 'b', text: 'middle', ts: 200 },
      { circleId: 'g1', msgId: 'c', text: 'last',   ts: 300 },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0,
    });
    expect(r.items.map((e) => e.msgId)).toEqual(['a', 'b', 'c']);
    expect(r.items.map((e) => e.text)).toEqual(['first', 'middle', 'last']);
    expect(r.truncated).toBe(false);
    // Envelope shape ready for inbox.ingestChatMessage.
    for (const env of r.items) {
      expect(env.subtype).toBe('kring-chat-message');
      expect(env.circleId).toBe('g1');
      expect(typeof env.ts).toBe('number');
      expect(env.fromActor).toBe(BOB);
    }
  });

  it('sinceTs filter excludes older messages (inclusive boundary)', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'old',     ts: 100 },
      { circleId: 'g1', msgId: 'b', text: 'cutoff',  ts: 200 },
      { circleId: 'g1', msgId: 'c', text: 'newer',   ts: 300 },
    ]);
    // Inclusive: ts === sinceTs is kept (we want the boundary message
    // back in case the caller dropped it — inbox dedupes anyway).
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g1', sinceTs: 200,
    });
    expect(r.items.map((e) => e.text)).toEqual(['cutoff', 'newer']);
  });

  it('max cap → truncated:true + only last N messages', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: '1', text: 'one',   ts: 100 },
      { circleId: 'g1', msgId: '2', text: 'two',   ts: 200 },
      { circleId: 'g1', msgId: '3', text: 'three', ts: 300 },
      { circleId: 'g1', msgId: '4', text: 'four',  ts: 400 },
      { circleId: 'g1', msgId: '5', text: 'five',  ts: 500 },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0, max: 3,
    });
    expect(r.truncated).toBe(true);
    expect(r.items.map((e) => e.text)).toEqual(['three', 'four', 'five']);
  });

  it('returns empty when the requested groupId has no chats', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'hi g1', ts: 100 },
      { circleId: 'g1', msgId: 'b', text: 'still g1', ts: 200 },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g2', sinceTs: 0,
    });
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('returns empty {items, truncated:false} when groupId is missing', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'hi', ts: 100 },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', { sinceTs: 0 });
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('defaults sinceTs to 0 and max to 200 when omitted', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    // Seed 250 messages — over the 200 default cap.
    const chats = [];
    for (let i = 1; i <= 250; i += 1) {
      chats.push({ circleId: 'g1', msgId: `m${i}`, text: `t${i}`, ts: i * 10 });
    }
    await seedChats(bundle, chats);

    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: 'g1' });
    expect(r.items).toHaveLength(200);
    expect(r.truncated).toBe(true);
    // Default max=200 keeps the freshest 200, i.e. ts=510..2500.
    expect(r.items[0].ts).toBe(510);
    expect(r.items[r.items.length - 1].ts).toBe(2500);
  });

  it('hard-caps max at 1000', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'hi', ts: 100 },
    ]);
    // Pass max=99_999 — the skill must clamp internally; we can't
    // observe the clamp directly with only 1 item, but the call must
    // not throw and must return that 1 item.
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0, max: 99_999,
    });
    expect(r.items).toHaveLength(1);
    expect(r.truncated).toBe(false);
  });

  it('carries a stored media pointer on the envelope — absent stays absent (media P1)', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    const media = {
      kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:mx' },
      snapshot: { type: 'media', id: 'mx', source: { type: 'blob', ref: 'blob://kx', enc: { sealed: true } } },
    };
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'plain', text: 'hoi',         ts: 100 },
      { circleId: 'g1', msgId: 'photo', text: '📷 photo.jpg', ts: 200, media },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', { groupId: 'g1', sinceTs: 0 });
    const plain = r.items.find((e) => e.msgId === 'plain');
    const photo = r.items.find((e) => e.msgId === 'photo');
    expect(plain).not.toHaveProperty('media');   // legacy envelope shape untouched
    expect(photo.media).toEqual(media);          // chip survives catch-up
  });

  it('filters by groupId across multiple circles', async () => {
    const bundle = await buildBundle();
    await bundle.offeringMatch.start();
    await seedChats(bundle, [
      { circleId: 'g1', msgId: 'a', text: 'in g1',    ts: 100 },
      { circleId: 'g2', msgId: 'b', text: 'in g2',    ts: 200 },
      { circleId: 'g1', msgId: 'c', text: 'g1 again', ts: 300 },
    ]);
    const r = await callSkill(bundle.agent, 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0,
    });
    expect(r.items.map((e) => e.text)).toEqual(['in g1', 'g1 again']);
  });
});
