/**
 * Media consolidation (media Phase 1 anti-drift tail, 2026-07-10) —
 * stoop attachments ARE canonical `media` items.
 *
 * Drift guards (against the REAL `@canopy/item-types` schema — no
 * copied shape):
 *   - `persistInboundAttachment` emits a schema-valid `media` item
 *     whose `source.ref` is the install-independent
 *     `stoop-att://<itemId>/<attId>` name; the local cache path stays
 *     in the LOCAL-ONLY `ref` field.
 *   - `toWireShape` output is ALSO schema-valid, carries no local
 *     `ref` / `dataB64`, and keeps the legacy keys
 *     (id/mime/bytes/width/height/thumbnail) so mixed-version peers
 *     keep rendering.
 *   - Legacy records (pre-consolidation items; the chat-p2p
 *     substrate's receiver-built records) still pass through
 *     `toWireShape` in the legacy shape — no fake `media` typing.
 *   - End-to-end: postRequest → stored media item → bytes at the
 *     local ref → getAttachmentDataUrl unchanged; the catch-up path
 *     (listBuurtPostsSince) ships wire-shaped media items WITHOUT
 *     the local ref (closes the Phase 39 privacy-invariant leak).
 *   - Renderer equivalence: `renderAttachmentThumbs` produces the
 *     same interactive thumb (att-id + thumbnail src) for the
 *     media shape as for the legacy shape.
 *
 * Sealing status (honest): stoop has no sealer on its post path, so
 * this is the SHAPE consolidation. The sealed-blob follow-up swaps
 * `source` for blob-gateway's manifest line — readers key off
 * `source.ref`, so these guards keep holding.
 */

import { describe, it, expect } from 'vitest';
import { validate } from '@canopy/item-types';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import { createNeighborhoodAgent } from '../src/index.js';
import {
  persistInboundAttachment,
  toWireShape,
  toBroadcastShape,
  attachmentWireRef,
  parseAttachmentWireRef,
  STOOP_ATT_REF_TYPE,
  STOOP_ATT_REF_SCHEME,
} from '../src/lib/Attachments.js';

const ANNE = 'https://id.example/anne';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

function makeInbound(extra = {}) {
  return {
    mime:      'image/png',
    width:     1,
    height:    1,
    thumbnail: TINY_PNG_DATA_URL,
    dataB64:   TINY_PNG_B64,
    ...extra,
  };
}

/** Minimal in-memory data source (the CachingDataSource surface we use). */
function memSource() {
  const m = new Map();
  return {
    write: async (k, v) => { m.set(k, v); },
    read:  async (k) => m.get(k) ?? null,
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

describe('media consolidation — wire-ref convention', () => {
  it('attachmentWireRef builds stoop-att://<itemId>/<attId> and parses back', () => {
    const ref = attachmentWireRef('item-9', 'att-abc-def');
    expect(ref).toBe('stoop-att://item-9/att-abc-def');
    expect(parseAttachmentWireRef(ref)).toEqual({ itemId: 'item-9', attId: 'att-abc-def' });
  });

  it('parseAttachmentWireRef rejects foreign / malformed refs', () => {
    expect(parseAttachmentWireRef('blob://somekey')).toBeNull();
    expect(parseAttachmentWireRef('stoop-att://only-one-segment')).toBeNull();
    expect(parseAttachmentWireRef(`${STOOP_ATT_REF_SCHEME}item/`)).toBeNull();
    expect(parseAttachmentWireRef(null)).toBeNull();
  });
});

describe('media consolidation — persistInboundAttachment emits a canonical media item', () => {
  it('validates against the REAL @canopy/item-types media schema', async () => {
    const ds = memSource();
    const rec = await persistInboundAttachment({
      dataSource: ds, itemId: 'item-1', att: makeInbound(), actor: ANNE,
    });
    // Canonical shape — the real registry is the drift guard.
    const check = validate(rec);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(rec.type).toBe('media');
    expect(rec.createdBy).toBe(ANNE);
    expect(rec.source).toEqual({
      type: STOOP_ATT_REF_TYPE,
      ref:  attachmentWireRef('item-1', rec.id),
    });
    // Canonical render hints ride the canonical keys.
    expect(rec.mime).toBe('image/png');
    expect(rec.width).toBe(1);
    expect(rec.height).toBe(1);
    // Stoop extras + the LOCAL-ONLY cache ref (bytes stay where they lived).
    expect(rec.thumbnail).toBe(TINY_PNG_DATA_URL);
    expect(rec.ref).toMatch(/^mem:\/\/stoop\/items\/item-1\/attachments\/att-.+\.png$/);
    expect(rec).not.toHaveProperty('dataB64');
    // The bytes really are at the local ref.
    const stored = await ds.read(rec.ref);
    expect(stored?.byteLength).toBeGreaterThan(0);
  });
});

describe('media consolidation — toWireShape', () => {
  it('media record: schema-valid on the wire, no local ref, legacy keys intact', async () => {
    const rec = await persistInboundAttachment({
      dataSource: memSource(), itemId: 'item-2', att: makeInbound(), actor: ANNE,
    });
    const wire = toWireShape(rec);
    expect(wire).not.toHaveProperty('ref');
    expect(wire).not.toHaveProperty('dataB64');
    // Still a valid canonical media item after stripping.
    const check = validate(wire);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(wire.source.ref.startsWith(STOOP_ATT_REF_SCHEME)).toBe(true);
    // Old peers read these exact keys — pinned.
    for (const k of ['id', 'mime', 'bytes', 'width', 'height', 'thumbnail']) {
      expect(wire).toHaveProperty(k);
    }
  });

  it('legacy record (chat-p2p receiver shape): legacy wire shape, no fake media typing', () => {
    const wire = toWireShape({
      id: 'att-legacy', mime: 'image/jpeg', bytes: 100, width: 10, height: 10,
      thumbnail: 'data:image/jpeg;base64,X', ref: 'mem://leaky/path', dataB64: 'OOPS',
    });
    expect(wire).toEqual({
      id: 'att-legacy', mime: 'image/jpeg', bytes: 100, width: 10, height: 10,
      thumbnail: 'data:image/jpeg;base64,X',
    });
    expect(wire).not.toHaveProperty('type');
    expect(wire).not.toHaveProperty('source');
  });
});

describe('media consolidation — attachment flow round-trip', () => {
  it('postRequest stores a schema-valid media item; data-URL path unchanged', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'Wie wil deze foto zien?',
      kind: 'ask',
      attachments: [makeInbound()],
    });
    expect(r.requestId).toBeTruthy();

    const item = await bundle.itemStore.getById(r.requestId);
    const att = item.source.attachments[0];
    const check = validate(att);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(att.createdBy).toBe(ANNE);
    expect(parseAttachmentWireRef(att.source.ref)).toEqual({
      itemId: r.requestId, attId: att.id,
    });

    // Behaviour preservation: same rendered bytes as before the shape change.
    const dataUrl = await callSkill(bundle.agent, 'getAttachmentDataUrl', {
      itemId: r.requestId, attId: att.id,
    });
    expect(dataUrl.ok).toBe(true);
    expect(dataUrl.dataUrl).toBe(TINY_PNG_DATA_URL);

    // requestAttachment on our own post short-circuits to the local ref.
    const req = await callSkill(bundle.agent, 'requestAttachment', {
      itemId: r.requestId, attId: att.id,
    });
    expect(req.ok).toBe(true);
    expect(req.ref).toMatch(/^mem:\/\//);
  });

  it('catch-up (listBuurtPostsSince) ships wire-shaped media items — local ref never leaks', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'catch-up post met foto',
      kind: 'ask',
      attachments: [makeInbound()],
    });
    expect(r.requestId).toBeTruthy();

    const out = await callSkill(bundle.agent, 'listBuurtPostsSince', {
      groupId: 'oosterpoort', sinceMs: 0,
    });
    const post = out.posts.find(p => p.requestId === r.requestId);
    expect(post).toBeTruthy();
    expect(post.attachments.length).toBe(1);
    const att = post.attachments[0];
    // The privacy invariant, now enforced on the catch-up path too.
    expect(att).not.toHaveProperty('ref');
    expect(att).not.toHaveProperty('dataB64');
    // And it is still a schema-valid media item on the wire.
    const check = validate(att);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
  });

  it('broadcast shape == wire shape for every persisted media item', async () => {
    const rec = await persistInboundAttachment({
      dataSource: memSource(), itemId: 'item-3', att: makeInbound(), actor: ANNE,
    });
    expect(toBroadcastShape([rec])).toEqual([toWireShape(rec)]);
  });
});

describe('media consolidation — renderer equivalence (web/app.js)', () => {
  it('renderAttachmentThumbs renders the media shape and the legacy shape equivalently', async () => {
    const { renderAttachmentThumbs } = await import('../web/app.js');

    const base = {
      id: 'att-x', mime: 'image/png', bytes: 68, width: 1, height: 1,
      thumbnail: TINY_PNG_DATA_URL,
    };
    const mediaShaped = {
      id: 'item-render',
      source: {
        attachments: [{
          ...base,
          type: 'media',
          createdAt: new Date().toISOString(),
          createdBy: ANNE,
          source: { type: STOOP_ATT_REF_TYPE, ref: attachmentWireRef('item-render', 'att-x') },
        }],
      },
    };
    const legacyShaped = { id: 'item-render', source: { attachments: [base] } };

    const htmlMedia  = renderAttachmentThumbs(mediaShaped);
    const htmlLegacy = renderAttachmentThumbs(legacyShaped);

    // Identical rendered result — the media wrapper changes nothing the
    // user sees, and the click affordance (item-id + att-id + thumb)
    // survives for both shapes.
    expect(htmlMedia).toBe(htmlLegacy);
    expect(htmlMedia).toContain('data-att-id="att-x"');
    expect(htmlMedia).toContain(`src="${TINY_PNG_DATA_URL}"`);
    expect(htmlMedia).toContain('class="attachment-thumb"');
  });

  it('renders nothing for attachment-less items (unchanged)', async () => {
    const { renderAttachmentThumbs } = await import('../web/app.js');
    expect(renderAttachmentThumbs({ id: 'x', source: {} })).toBe('');
  });
});
