/**
 * basis v2 — circleMediaGateway REMOTE mode (PLAN-media-infra-deployment,
 * client slice). Full-size photos go to a DEPLOYED edge/bucket instead of the
 * per-session dev bucket. Decisions under test:
 *   • capability-token auth — the member SELF-SIGNS its own `media.read` token
 *     (issuer === subject === the member's key; minted ONCE per composition),
 *   • presigned-PUT uploads — the client asks the edge to presign a PUT, uploads
 *     the SEALED bytes straight to the bucket, then grants the roster,
 *   • self-signed media.read reads — a full-image read is presigned by the edge
 *     (its verifier + ACL decide) and the ciphertext is fetched + unsealed.
 *
 * The edge is a STUB `fetch` honouring the blobGateMount wire (/upload-url → PUT
 * sink → /grant → presign → ciphertext), backed by the REAL capability verifier
 * (@onderling/blob-gateway) so the minted token is genuinely checked — no crypto
 * short-cut. Sealing is a REAL group-key pair (@onderling/pod-client/sealing), the
 * same seam the other media suites use.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

import { AgentIdentity, CapabilityToken } from '@onderling/core';
import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { createCapabilityVerifier } from '@onderling/blob-gateway/adapters/capability-verifier';

import {
  createCircleMediaGateway, createRemoteMediaBucket, createCircleMediaComposition,
  makeDevMediaBucket,
} from '../../src/v2/circleMediaGateway.js';
import { createMediaEmbed } from '../../src/core/handlers/mediaEmbed.js';

const t = (key) => key;
const CIRCLE = { id: 'g1', name: 'Selwerd' };
const GATE_URL = 'https://relay.example/blob-gate';

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);
const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, 'binary').toString('base64');
};

function stubFile(bytes = fullBytes(), { name = 'photo.jpg', type = 'image/jpeg' } = {}) {
  return {
    name, type, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
const stubEncodeImage = ({ bytes = fullBytes(), thumb = thumbBytes() } = {}) => async () => ({
  mime: 'image/jpeg', dataB64: b64(bytes), width: 640, height: 480,
  thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
});

/** A p2-style circle seal strategy — the {seal, open} shape the control agent resolves to. */
function groupStrategy() {
  const groupKey = generateGroupKey();
  return { seal: makeGroupSealer(groupKey), open: makeGroupOpener(groupKey) };
}

const makeIdentity = () => new AgentIdentity({ seed: crypto.randomBytes(32) });

const jsonRes = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
const textRes = (status, text) => ({ ok: status < 400, status, text: async () => text });

/**
 * A STUB blob-gate edge as an injectable `fetch`. Faithful to blobGateMount's
 * wire + auth: reads/grants are gated by the REAL capability verifier, grants
 * are gated by an uploaders allow-list, and reads are deny-by-default against a
 * per-ref grant record. `/upload-url` is the (not-yet-in-blobGateMount) presign
 * PUT route this client contract adds.
 *
 * @param {object} a
 * @param {string[]} a.uploaders   actor ids allowed to grant (the roster minus non-uploaders)
 * @param {boolean}  [a.denyGrant] force every /grant to a 403 (grant-route denial test)
 */
function makeStubEdge({ uploaders, denyGrant = false } = {}) {
  const store   = new Map();   // bucketKey → sealed ciphertext (string)
  const acl     = new Map();   // 'blob://<key>' → Set(actorId)
  const putUrls = new Map();   // presigned PUT url → bucketKey
  const getUrls = new Map();   // presigned GET url → bucketKey
  const log     = { grants: [], uploads: [], reads: 0 };
  const verify  = createCapabilityVerifier();         // real: sig + self-issued + skill
  const allow   = new Set(uploaders ?? []);
  let n = 0;

  const bearer = (init) => {
    const auth = init?.headers?.authorization ?? '';
    const m = /^\s*Bearer\s+(.+)$/i.exec(auth);
    return m ? m[1] : null;
  };
  const bodyOf = (init) => (init?.body ? JSON.parse(init.body) : {});

  async function fetchImpl(url, init = {}) {
    // GET a presigned url → the stored ciphertext.
    if ((init.method ?? 'GET') === 'GET') {
      const key = getUrls.get(url);
      if (!key || !store.has(key)) return textRes(404, '');
      log.reads += 1;
      return textRes(200, store.get(key));
    }
    // PUT the sealed bytes to a presigned url.
    if (init.method === 'PUT') {
      const key = putUrls.get(url);
      if (!key) return jsonRes(404, { error: 'unknown put url' });
      store.set(key, typeof init.body === 'string' ? init.body : String(init.body));
      log.uploads.push(key);
      return jsonRes(200, { ok: true });
    }

    const webId = (await verify(bearer(init)))?.webId ?? null;

    if (url === `${GATE_URL}/upload-url`) {
      if (!webId) return jsonRes(403, { error: 'forbidden' });
      const { key } = bodyOf(init);
      const putUrl = `${GATE_URL}/put/${key}?sig=${(n += 1)}`;
      putUrls.set(putUrl, key);
      return jsonRes(200, { url: putUrl });
    }
    if (url === `${GATE_URL}/grant`) {
      if (denyGrant) return jsonRes(403, { error: 'forbidden' });
      if (!webId || !allow.has(webId)) return jsonRes(403, { error: 'forbidden' });
      const { key, actors } = bodyOf(init);   // key is the 'blob://<k>' ref
      if (typeof key !== 'string' || !Array.isArray(actors) || actors.length === 0) {
        return jsonRes(403, { error: 'forbidden' });
      }
      acl.set(key, new Set([...(acl.get(key) ?? []), ...actors]));
      log.grants.push({ key, actors });
      return jsonRes(200, { ok: true, granted: actors.length });
    }
    if (url === GATE_URL) {                    // read presign (deny-by-default)
      const { ref } = bodyOf(init);
      if (!webId || acl.get(ref)?.has(webId) !== true) return jsonRes(403, { error: 'forbidden' });
      const getUrl = `${GATE_URL}/get?sig=${(n += 1)}`;
      getUrls.set(getUrl, ref.slice('blob://'.length));
      return jsonRes(200, { url: getUrl });
    }
    return jsonRes(404, { error: 'not found' });
  }

  return { fetch: fetchImpl, store, acl, log };
}

describe('circleMediaGateway REMOTE mode — the deployed edge/bucket slice', () => {
  it('sealed-only stands: no seal strategy → null even with a remote configured', async () => {
    const me = makeIdentity();
    const edge = makeStubEdge({ uploaders: [me.pubKey] });
    expect(await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => null, localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: [me.pubKey], fetch: edge.fetch },
    })).toBeNull();
    // a throwing resolver degrades the same way
    expect(await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => { throw new Error('pod down'); }, localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: [me.pubKey], fetch: edge.fetch },
    })).toBeNull();
  });

  it('mints a REAL self-signed media.read token once (issuer === subject, skill media.read)', async () => {
    const me = makeIdentity();
    const edge = makeStubEdge({ uploaders: [me.pubKey] });
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: [me.pubKey], fetch: edge.fetch },
    });
    expect(comp).not.toBeNull();

    const raw = JSON.parse(comp.mediaGateway.token);
    expect(raw.issuer).toBe(me.pubKey);
    expect(raw.subject).toBe(me.pubKey);          // SELF-signed
    expect(raw.issuer).toBe(raw.subject);
    expect(raw.skill).toBe('media.read');
    expect(raw.agentId).toBe('blob-gate');

    // it is a genuinely-signed capability token — the real verifier accepts it
    const verify = createCapabilityVerifier();
    expect(await verify(comp.mediaGateway.token)).toEqual({ webId: me.pubKey });
    // ...and the seams the handler needs are present
    expect(typeof comp.mediaGateway.bucket.put).toBe('function');
    expect(typeof comp.mediaGateway.gate).toBe('function');
    expect(comp.mediaGateway.keyRef).toBe('urn:circle:g1:content-key');
  });

  it('upload SEALS + PUTs + GRANTS the roster; a full-image read round-trips the sealed bytes', async () => {
    const me    = makeIdentity();
    const peer  = makeIdentity();
    const roster = [me.pubKey, peer.pubKey];
    const edge  = makeStubEdge({ uploaders: roster });
    const comp  = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: roster, fetch: edge.fetch },
    });

    const encoded = fullBytes();
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway,
      encodeImage: stubEncodeImage({ bytes: encoded }), localActor: 'me', t,
    });
    expect(embed.ok).not.toBe(false);
    const line = embed.snapshot.source;

    // The edge bucket holds ONLY sealed ciphertext — no leaked plaintext.
    expect(edge.store.size).toBeGreaterThan(0);
    for (const stored of edge.store.values()) expect(isSealed(stored)).toBe(true);
    expect(JSON.stringify([...edge.store.values()])).not.toContain(b64(encoded));

    // The roster was granted read on the uploaded ref (grant-on-upload fan-out).
    expect(edge.log.grants).toHaveLength(1);
    expect(edge.log.grants[0].key).toBe(line.ref);
    expect(edge.log.grants[0].actors).toEqual(roster);
    expect([...edge.acl.get(line.ref)]).toEqual(expect.arrayContaining(roster));

    // Full image: byte-for-byte back through the edge gate + presigned GET.
    const opened = await comp.openFullImage(line);
    expect(Array.from(opened.bytes)).toEqual(Array.from(encoded));
    expect(opened.media).toMatchObject({ mime: 'image/jpeg', width: 640, height: 480 });
    expect(edge.log.reads).toBeGreaterThan(0);
  });

  it('deny-by-default holds at the edge: a foreign token and an ungranted ref are refused', async () => {
    const me   = makeIdentity();
    const edge = makeStubEdge({ uploaders: [me.pubKey] });
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: [me.pubKey], fetch: edge.fetch },
    });
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway, encodeImage: stubEncodeImage(), localActor: 'me', t,
    });
    const line = embed.snapshot.source;

    // Our own token IS on the ref's grant list → the gate presigns a url.
    expect(await comp.mediaGateway.gate(comp.mediaGateway.token, line.ref)).toMatchObject({ url: expect.any(String) });

    // A stranger's self-signed token is NOT on the ref's grant list → denied.
    const stranger = makeIdentity();
    const strangerTok = (await CapabilityToken.issue(stranger, {
      subject: stranger.pubKey, agentId: 'blob-gate', skill: 'media.read',
    })).toString();
    expect(await comp.mediaGateway.gate(strangerTok, line.ref)).toEqual({ denied: true });

    // An unknown ref, even with OUR token, is denied (never granted).
    expect(await comp.mediaGateway.gate(comp.mediaGateway.token, 'blob://never-granted')).toEqual({ denied: true });
  });

  it('GRANT-route denial SURFACES out of the upload — it is not silently dropped', async () => {
    const me   = makeIdentity();
    const edge = makeStubEdge({ uploaders: [me.pubKey], denyGrant: true });
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, memberActors: [me.pubKey], fetch: edge.fetch },
    });
    // The sealed bytes reach the bucket, but the grant is refused → put THROWS.
    await expect(comp.mediaGateway.bucket.put('k1', 'sealed-ciphertext-string'))
      .rejects.toThrow(/grant/i);
    // And driven through the handler, the failure surfaces as a non-ok embed (not a silent success).
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway, encodeImage: stubEncodeImage(), localActor: 'me', t,
    });
    expect(embed.ok).toBe(false);
  });
});

describe('createCircleMediaComposition — roster → SIGNING-key grant wiring (live-peer reads)', () => {
  /** A MemberMap-shaped resolver: webid → { pubKey (signing), sealingPublicKey } | null. */
  const membersOf = (rows) => ({
    resolveByWebid: async (w) => rows.find((r) => r.webid === w) ?? null,
  });

  it('grants EXACTLY the resolved SIGNING keys (not sealing keys); a keyed peer OPENS the sealed blob', async () => {
    const me   = makeIdentity();
    const anne = makeIdentity();
    const bob  = makeIdentity();
    // Roster rows carry a SIGNING pubKey AND a DISTINCT sealing key — the grant must
    // pick the signing key (the ACL/verifier subject), never the sealing key.
    const rows = [
      { webid: 'w:anne', pubKey: anne.pubKey, sealingPublicKey: 'SEAL-anne' },
      { webid: 'w:bob',  pubKey: bob.pubKey,  sealingPublicKey: 'SEAL-bob'  },
    ];
    const edge = makeStubEdge({ uploaders: [me.pubKey, anne.pubKey, bob.pubKey] });

    const comp = await createCircleMediaComposition({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: {
        gateUrl: GATE_URL, identity: me, members: membersOf(rows), roster: rows, fetch: edge.fetch,
      },
    });
    expect(comp).not.toBeNull();
    expect(comp.unresolvedMembers).toBe(0);

    // Upload → the grant carries the two members' SIGNING keys + the uploader's own key.
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway, encodeImage: stubEncodeImage(), localActor: 'me', t,
    });
    expect(embed.ok).not.toBe(false);
    const line = embed.snapshot.source;

    expect(edge.log.grants).toHaveLength(1);
    const grantedActors = edge.log.grants[0].actors;
    expect(new Set(grantedActors)).toEqual(new Set([me.pubKey, anne.pubKey, bob.pubKey]));
    // The SEALING keys must NOT appear in the grant — signing-key ACL only.
    expect(grantedActors).not.toContain('SEAL-anne');
    expect(grantedActors).not.toContain('SEAL-bob');

    // A keyed peer (anne) self-signs her OWN media.read token → the edge ADMITS her
    // (her signing key is in the read-ACL) → presigned GET.
    const anneTok = (await CapabilityToken.issue(anne, {
      subject: anne.pubKey, agentId: 'blob-gate', skill: 'media.read',
    })).toString();
    expect(await comp.mediaGateway.gate(anneTok, line.ref)).toMatchObject({ url: expect.any(String) });
  });

  it('a member WITHOUT a captured signing key is REPORTED unresolved — not authorized, not a silent drop', async () => {
    const me   = makeIdentity();
    const anne = makeIdentity();
    const carol = makeIdentity();   // carol redeemed by code but her signing key was never captured
    const rows = [
      { webid: 'w:anne',  pubKey: anne.pubKey },
      { webid: 'w:carol', pubKey: null },       // no signing key yet
    ];
    const edge = makeStubEdge({ uploaders: [me.pubKey, anne.pubKey] });

    const comp = await createCircleMediaComposition({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me',
      remote: {
        gateUrl: GATE_URL, identity: me, members: membersOf(rows), roster: rows, fetch: edge.fetch,
      },
    });
    // Carol is surfaced as unresolved — not silently swallowed.
    expect(comp.unresolvedMembers).toBe(1);

    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway, encodeImage: stubEncodeImage(), localActor: 'me', t,
    });
    const line = embed.snapshot.source;

    // The grant authorizes me + anne only — carol is NOT in the actors (never fabricated).
    const grantedActors = edge.log.grants[0].actors;
    expect(new Set(grantedActors)).toEqual(new Set([me.pubKey, anne.pubKey]));

    // Carol, self-signing her real key, is DENIED (she was never granted) — no silent authorize.
    const carolTok = (await CapabilityToken.issue(carol, {
      subject: carol.pubKey, agentId: 'blob-gate', skill: 'media.read',
    })).toString();
    expect(await comp.mediaGateway.gate(carolTok, line.ref)).toEqual({ denied: true });
  });

  it('sealed-only stands: no seal strategy → null even with a roster + edge configured', async () => {
    const me = makeIdentity();
    const rows = [{ webid: 'w:anne', pubKey: makeIdentity().pubKey }];
    const edge = makeStubEdge({ uploaders: [me.pubKey] });
    expect(await createCircleMediaComposition({
      circleId: CIRCLE.id, getSealStrategy: async () => null, localActor: 'me',
      remote: { gateUrl: GATE_URL, identity: me, members: membersOf(rows), roster: rows, fetch: edge.fetch },
    })).toBeNull();
  });

  it('falls back to the DEV bucket path (unchanged) when no remote edge is configured', async () => {
    const bucket = makeDevMediaBucket();
    const comp = await createCircleMediaComposition({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: 'me', bucket,
    });
    expect(comp).not.toBeNull();
    expect(comp.unresolvedMembers).toBeUndefined();   // no roster resolution in dev mode
    expect(comp.mediaGateway.token).toMatch(/^dev-media-/);   // the session-local dev token, not a cap token
  });
});

describe('createRemoteMediaBucket — the presign-PUT-then-grant upload primitive', () => {
  it('presigns, PUTs the exact bytes, then grants the ref to the roster', async () => {
    const me   = makeIdentity();
    const roster = [me.pubKey, makeIdentity().pubKey];
    const edge = makeStubEdge({ uploaders: roster });
    const token = (await CapabilityToken.issue(me, {
      subject: me.pubKey, agentId: 'blob-gate', skill: 'media.read',
    })).toString();
    const bucket = createRemoteMediaBucket({ gateUrl: GATE_URL, token, memberActors: roster, fetch: edge.fetch });

    await bucket.put('abc', 'sealed-xyz');
    expect(edge.store.get('abc')).toBe('sealed-xyz');
    expect(edge.log.uploads).toEqual(['abc']);
    expect(edge.log.grants[0]).toEqual({ key: 'blob://abc', actors: roster });
  });
});
