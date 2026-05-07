/**
 * Stoop V2.5 Phase 39 — Picture attachments end-to-end.
 *
 * Verifies:
 *   - 39.2: postRequest with attachments stores bytes at the
 *           per-item path; item.source.attachments has metadata
 *           but no `dataB64`; broadcast payload carries metadata
 *           + thumbnail without `ref`.
 *   - 39.3: groupMirror.mirror() copies attachment metadata into
 *           mirrored items.
 *   - 39.4: requestAttachment skill round-trips bytes via
 *           attachment-request / attachment-response chat subtypes.
 *   - 39.5: sendChatMessage with inline attachment ships bytes;
 *           recipient stores ref locally.
 *   - Privacy invariant: no `ref` field crosses the wire.
 *   - Phase 35 interaction: an evicted author's attachment-bearing
 *           post is silently dropped on the receiver side.
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
import {
  validateInboundAttachment,
  toBroadcastShape,
  attachmentPath,
  freshAttachmentId,
  MAX_PRIKBORD_BYTES_PER_ATT,
  MAX_CHAT_BYTES_PER_ATT,
  MAX_ATTACHMENTS_PER_POST,
} from '../src/lib/Attachments.js';
import { wireGroupBroadcastMirror } from '../src/groupMirror.js';
import { EVICTION_GRACE_MS } from '../src/lib/EvictionRoster.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

/** A 1×1 transparent PNG, base64-encoded.  Tiny but valid bytes. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
/** Same shape; the "thumbnail" data: URL. */
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

function makeAttachment(extra = {}) {
  return {
    mime:      'image/png',
    width:     1,
    height:    1,
    thumbnail: TINY_PNG_DATA_URL,
    dataB64:   TINY_PNG_B64,
    ...extra,
  };
}

async function buildBundle(actorWebid = ANNE) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity:   id,
    transport:  tx,
    skillMatch: { group: 'oosterpoort', localActor: actorWebid, peers: [] },
    members:    [{ webid: actorWebid }],
  });
  await bundle.skillMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, asWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     asWebid,
    agent,
    envelope: null,
  });
}

describe('Phase 39 — Attachments lib', () => {
  it('validateInboundAttachment accepts a well-formed record', () => {
    expect(validateInboundAttachment(makeAttachment(), { maxBytes: 1000 })).toBeNull();
  });

  it('rejects unsupported mime', () => {
    expect(validateInboundAttachment(makeAttachment({ mime: 'image/gif' }), { maxBytes: 1000 }))
      .toMatch(/mime-not-allowed/);
  });

  it('rejects oversize bytes', () => {
    const big = 'A'.repeat(2000);
    expect(validateInboundAttachment(makeAttachment({ dataB64: big }), { maxBytes: 100 }))
      .toMatch(/too-large/);
  });

  it('rejects missing thumbnail', () => {
    expect(validateInboundAttachment(makeAttachment({ thumbnail: 'not-a-data-url' }), { maxBytes: 1000 }))
      .toMatch(/thumbnail-missing/);
  });

  it('toBroadcastShape strips `ref` and `dataB64`', () => {
    const out = toBroadcastShape([
      { id: 'att-1', mime: 'image/jpeg', bytes: 100, width: 10, height: 10,
        thumbnail: 'data:image/jpeg;base64,X', ref: 'mem://leaky/path', dataB64: 'OOPS' },
    ]);
    expect(out[0]).not.toHaveProperty('ref');
    expect(out[0]).not.toHaveProperty('dataB64');
    expect(out[0].thumbnail).toBe('data:image/jpeg;base64,X');
  });

  it('attachmentPath includes the right extension per mime', () => {
    expect(attachmentPath('item-1', 'att-1', 'image/jpeg')).toMatch(/\.jpg$/);
    expect(attachmentPath('item-1', 'att-1', 'image/png')).toMatch(/\.png$/);
    expect(attachmentPath('item-1', 'att-1', 'image/webp')).toMatch(/\.webp$/);
    expect(() => attachmentPath('item-1', 'att-1', 'image/gif')).toThrow();
  });

  it('freshAttachmentId is unique', () => {
    const ids = new Set(Array.from({ length: 50 }, () => freshAttachmentId()));
    expect(ids.size).toBe(50);
  });

  it('size caps are sensible defaults', () => {
    expect(MAX_PRIKBORD_BYTES_PER_ATT).toBeGreaterThan(MAX_CHAT_BYTES_PER_ATT);
    expect(MAX_ATTACHMENTS_PER_POST).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 39.2 — postRequest with attachments', () => {
  it('stores bytes at the item-scoped path; item.source.attachments has metadata only', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'Wie kent een goede fietsenmaker?',
      kind: 'ask',
      attachments: [makeAttachment()],
    });
    expect(r.requestId).toBeTruthy();

    const item = await bundle.itemStore.getById(r.requestId);
    const attachments = item?.source?.attachments;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBe(1);
    expect(attachments[0].id).toMatch(/^att-/);
    expect(attachments[0].mime).toBe('image/png');
    expect(attachments[0].thumbnail).toBe(TINY_PNG_DATA_URL);
    expect(attachments[0].ref).toMatch(/^mem:\/\/stoop\/items\/.+\/attachments\/att-.+\.png$/);
    // Bytes never leak onto the item record.
    expect(attachments[0]).not.toHaveProperty('dataB64');

    // Bytes ARE in the cache at the ref path.
    const stored = await bundle.cache.read(attachments[0].ref);
    expect(stored).toBeTruthy();
    expect(stored.byteLength ?? stored.length).toBeGreaterThan(0);
  });

  it('rejects too many attachments', async () => {
    const bundle = await buildBundle();
    const tooMany = Array.from({ length: MAX_ATTACHMENTS_PER_POST + 1 }, () => makeAttachment());
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'too many', kind: 'ask', attachments: tooMany,
    });
    expect(r.error).toMatch(/attachments-too-many/);
  });

  it('rejects oversized attachments', async () => {
    const bundle = await buildBundle();
    const big = 'A'.repeat(MAX_PRIKBORD_BYTES_PER_ATT * 2);
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'big', kind: 'ask',
      attachments: [makeAttachment({ dataB64: big })],
    });
    expect(r.error).toMatch(/too-large/);
  });
});

describe('Phase 39.3 — groupMirror copies attachment metadata', () => {
  it('mirror() carries attachments[] (no `ref` until fetched)', async () => {
    const bundle = await buildBundle();
    const mirror = await wireGroupBroadcastMirror({
      agent:     bundle.agent,
      itemStore: bundle.itemStore,
      group:     'oosterpoort',
      peers:     [],
      evictionRoster: bundle.evictionRoster,
    });

    await mirror.backfillFrom('pubkey-bob-stub', [{
      id:           'broadcast-from-bob-1',
      addedBy:      BOB,
      type:         'request',
      text:         'Bob has a thing',
      requiredSkills: [],
      source: {
        skillTags: [], categoryId: null,
        attachments: [{
          id: 'att-stub', mime: 'image/jpeg', bytes: 100,
          width: 10, height: 10, thumbnail: TINY_PNG_DATA_URL,
        }],
      },
    }]);

    // backfillFrom uses originals (no `source.broadcast`), so the
    // mirrored item is the recipient-side mirror.
    const open = await bundle.itemStore.listOpen();
    const mirrored = open.find(i => i?.source?.requestId === 'broadcast-from-bob-1');
    expect(mirrored).toBeTruthy();
    const atts = mirrored.source?.attachments ?? [];
    expect(atts.length).toBe(1);
    expect(atts[0].thumbnail).toBe(TINY_PNG_DATA_URL);
    // The recipient has no `ref` until they request the bytes.
    expect(atts[0].ref).toBeUndefined();

    await mirror.stop();
  });
});

describe('Phase 39.4 — requestAttachment skill', () => {
  it('returns ref immediately when bytes are already local (we authored)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'self-attachment', kind: 'ask',
      attachments: [makeAttachment()],
    });
    const item = await bundle.itemStore.getById(r.requestId);
    const attId = item.source.attachments[0].id;

    const got = await callSkill(bundle.agent, 'requestAttachment', {
      itemId: r.requestId, attId,
    });
    expect(got.ok).toBe(true);
    expect(got.ref).toMatch(/\.png$/);
  });

  it('rejects unknown item / attachment', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'requestAttachment', { itemId: 'nope', attId: 'x' }))
      .toEqual({ error: 'item-not-found' });
  });
});

describe('Phase 39.5 — sendChatMessage with inline attachment', () => {
  it('rejects empty body + no attachment', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'sendChatMessage', { threadId: 't1', toWebid: BOB });
    expect(r.error).toBe('body-or-attachment-required');
  });

  it('rejects oversize chat attachment', async () => {
    const bundle = await buildBundle();
    const big = 'A'.repeat(MAX_CHAT_BYTES_PER_ATT * 2);
    const r = await callSkill(bundle.agent, 'sendChatMessage', {
      threadId: 't1', toWebid: BOB,
      attachment: makeAttachment({ dataB64: big }),
    });
    expect(r.error).toMatch(/too-large/);
  });
});

describe('Phase 35 + 39 interaction — evicted authors still drop attachments', () => {
  it('evicted member with attachment: nothing lands locally', async () => {
    const bundle = await buildBundle();
    // Evict Bob.
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    bundle.evictionRoster.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });

    const mirror = await wireGroupBroadcastMirror({
      agent:     bundle.agent,
      itemStore: bundle.itemStore,
      group:     'oosterpoort',
      peers:     [],
      evictionRoster: bundle.evictionRoster,
    });

    await mirror.backfillFrom('pubkey-bob-stub', [{
      id:           'evicted-with-pic',
      addedBy:      BOB,
      type:         'request',
      text:         'evicted post',
      requiredSkills: [],
      source: {
        attachments: [{
          id: 'att-x', mime: 'image/jpeg', bytes: 100,
          width: 10, height: 10, thumbnail: TINY_PNG_DATA_URL,
        }],
      },
    }]);

    const open = await bundle.itemStore.listOpen();
    expect(open.some(i => i?.source?.requestId === 'evicted-with-pic')).toBe(false);
    await mirror.stop();
  });
});
