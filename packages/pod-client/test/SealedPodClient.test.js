import { describe, it, expect, vi } from 'vitest';
import {
  createSealedPodClient, recipientStrategy, groupKeyStrategy,
  generateKeypair, generateGroupKey, isSealed,
  buildGroupKeyResource, rotateGroupKeyResource,
} from '../src/sealing/index.js';

// A Map-backed fake PodClient: stores raw bytes (what the host would hold). read echoes opts so we can
// assert the wrapper reads raw (decode:'text'); structure methods are spied for pass-through checks.
function fakeInner() {
  const store = new Map();
  return {
    store,
    async write(uri, content) { store.set(uri, content); return { uri, ok: true }; },
    async read(uri, opts) {
      if (!store.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      return { uri, content: store.get(uri), contentType: 'text/plain', etag: 'W/1', _opts: opts };
    },
    async append(uri, line) { store.set(uri, (store.get(uri) ? store.get(uri) + '\n' : '') + line); return { ok: true }; },
    list: vi.fn(async () => ({ container: '/', entries: [] })),
    createContainer: vi.fn(async () => ({ ok: true })),
    on: vi.fn(), off: vi.fn(),
  };
}

describe('SealedPodClient — recipient strategy', () => {
  it('seals on write (host sees ciphertext) and opens on read', async () => {
    const k = generateKeypair();
    const inner = fakeInner();
    const sealed = createSealedPodClient(inner, recipientStrategy({ recipients: k.publicKey, privateKey: k.privateKey }));

    await sealed.write('/note', 'top secret');
    const raw = inner.store.get('/note');
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain('top secret');           // the host holds ciphertext only

    const res = await sealed.read('/note');
    expect(res.content).toBe('top secret');            // opened transparently
    expect(res.etag).toBe('W/1');                      // metadata preserved
    expect(res._opts.decode).toBe('string');           // force raw text decode (not 'auto', which can yield bytes/objects)
  });

  it('a writer with only public keys can seal; opening needs the private key', async () => {
    const k = generateKeypair();
    const inner = fakeInner();
    const writeOnly = createSealedPodClient(inner, recipientStrategy({ recipients: k.publicKey }));  // no privateKey
    await writeOnly.write('/x', 'data');               // host-blind write works
    await expect(writeOnly.read('/x')).rejects.toThrow(/private key/);
  });
});

describe('SealedPodClient — group-key strategy', () => {
  it('round-trips under a shared group key', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    const a = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    await a.write('/list', 'milk, bread');
    expect(isSealed(inner.store.get('/list'))).toBe(true);
    // a second member with the same group key reads it
    const b = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    expect((await b.read('/list')).content).toBe('milk, bread');
  });

  it('seals each appended line', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    await c.append('/log', 'line one');
    await c.append('/log', 'line two');
    const lines = inner.store.get('/log').split('\n');
    expect(lines.every(isSealed)).toBe(true);
    expect(lines).toHaveLength(2);
  });
});

// ── Phase 3 — the GENERAL sealed-pod content reader opens across key-rotation versions ──────────────────
// Real crypto throughout (no cipher mocks): content is sealed/opened through an actual SealedPodClient over
// the group-key strategy; the host (fakeInner) holds only ciphertext.
describe('SealedPodClient — group-key strategy, cross-version reader (Phase 3)', () => {
  it('CRYPTO 1 — a still-granted member opens BOTH pre- and post-rotation content through the general reader', async () => {
    const alice = generateKeypair(); const bob = generateKeypair();  // both present at v1
    const inner = fakeInner();

    // v1: alice + bob. Alice writes pre-rotation content — sealed under the CURRENT (v1) group key.
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey, bob.publicKey] });
    const v1Client = createSealedPodClient(inner, groupKeyStrategy({ resource: v1, privateKey: alice.privateKey }));
    await v1Client.write('/pre', 'sealed under v1');
    expect(isSealed(inner.store.get('/pre'))).toBe(true);          // host holds ciphertext
    expect(inner.store.get('/pre')).not.toContain('sealed under v1');

    // bob leaves → rotate to alice only; v1 is retained in history[].
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });
    const v2Client = createSealedPodClient(inner, groupKeyStrategy({ resource: v2, privateKey: alice.privateKey }));
    await v2Client.write('/post', 'sealed under v2');

    // Alice's CURRENT (v2) reader opens BOTH, resolving the version across retained history — this is the
    // bug fix: pre-rotation content is no longer unopenable after a rotation for a still-entitled member.
    expect((await v2Client.read('/pre')).content).toBe('sealed under v1');   // historic version
    expect((await v2Client.read('/post')).content).toBe('sealed under v2');  // current version
  });

  it('CRYPTO 2 — a member revoked at the rotation cannot open post-revocation content, but CAN still open pre-revocation content (forward secrecy)', async () => {
    const alice = generateKeypair(); const bob = generateKeypair();  // bob is revoked at the rotation
    const inner = fakeInner();

    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey, bob.publicKey] });
    const v1Client = createSealedPodClient(inner, groupKeyStrategy({ resource: v1, privateKey: alice.privateKey }));
    await v1Client.write('/pre', 'bob was entitled to this');

    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });   // bob revoked
    const aliceV2 = createSealedPodClient(inner, groupKeyStrategy({ resource: v2, privateKey: alice.privateKey }));
    await aliceV2.write('/post', 'after bob left');

    // Bob reads through the general reader with the post-rotation resource: his key unwraps ONLY the retained
    // v1 envelope, so his readable set is {v1}. He opens the pre-revocation content he was entitled to...
    const bobReader = createSealedPodClient(inner, groupKeyStrategy({ resource: v2, privateKey: bob.privateKey }));
    expect((await bobReader.read('/pre')).content).toBe('bob was entitled to this');
    // ...but holds NO version that opens post-revocation content → the read throws (forward secrecy intact).
    await expect(bobReader.read('/post')).rejects.toThrow();
    // ...and he cannot SEAL under the current version at all (not a current recipient).
    expect(() => groupKeyStrategy({ resource: v2, privateKey: bob.privateKey }).seal('write attempt')).toThrow(/not a recipient/);
  });

  it('CRYPTO 3 — never-rotated content opens unchanged (single-key back-compat + resource form agree)', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();

    // Single-key path — byte-identical to the pre-Phase-3 reader.
    const a = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    await a.write('/list', 'milk, bread');
    const b = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    expect((await b.read('/list')).content).toBe('milk, bread');

    // The cross-version reader over a single (v1, no history) resource opens that SAME never-rotated content
    // identically — the fast path degenerates to exactly the single-key open.
    const alice = generateKeypair();
    const v1 = buildGroupKeyResource({ version: 1, groupKey: gk, recipients: [alice.publicKey] });
    expect(v1.history).toBeUndefined();
    const viaResource = createSealedPodClient(inner, groupKeyStrategy({ resource: v1, privateKey: alice.privateKey }));
    expect((await viaResource.read('/list')).content).toBe('milk, bread');
  });

  it('the resource form requires a private key; the empty form still throws', () => {
    const alice = generateKeypair();
    const v1 = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [alice.publicKey] });
    expect(() => groupKeyStrategy({ resource: v1 })).toThrow(/private key/);
    expect(() => groupKeyStrategy({})).toThrow();
  });
});

describe('SealedPodClient — pass-through + guards', () => {
  it('forwards structure + event methods unchanged (bodies untouched)', async () => {
    const inner = fakeInner();
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: generateGroupKey() }));
    await c.list('/c'); c.on('x', () => {});
    expect(inner.list).toHaveBeenCalledWith('/c');
    expect(inner.on).toHaveBeenCalled();
    expect(c.inner).toBe(inner);
  });

  it('open passes legacy/plaintext bodies through (mixed pod)', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    inner.store.set('/legacy', 'unsealed value');      // pre-existing plaintext
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    expect((await c.read('/legacy')).content).toBe('unsealed value');
  });

  it('requires a valid inner client + strategy', () => {
    expect(() => createSealedPodClient(null, groupKeyStrategy({ groupKey: generateGroupKey() }))).toThrow();
    expect(() => createSealedPodClient(fakeInner(), {})).toThrow();
  });
});
