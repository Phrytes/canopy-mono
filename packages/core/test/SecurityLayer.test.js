import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityLayer, SecurityError, SEC } from '../src/security/SecurityLayer.js';
import { AgentIdentity }                      from '../src/identity/AgentIdentity.js';
import { VaultMemory }                        from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }     from '../src/transport/InternalTransport.js';
import { mkEnvelope, P }                      from '../src/Envelope.js';

async function makeIdentity() {
  return AgentIdentity.generate(new VaultMemory());
}

async function makeSetup() {
  const aliceId = await makeIdentity();
  const bobId   = await makeIdentity();

  const bus   = new InternalBus();
  const alice = new InternalTransport(bus, aliceId.pubKey);
  const bob   = new InternalTransport(bus, bobId.pubKey);

  const aliceSec = new SecurityLayer({ identity: aliceId });
  const bobSec   = new SecurityLayer({ identity: bobId });

  // Cross-register peers.
  aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
  bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

  alice.useSecurityLayer(aliceSec);
  bob.useSecurityLayer(bobSec);

  await alice.connect();
  await bob.connect();

  return { alice, bob, aliceId, bobId, aliceSec, bobSec };
}

describe('SecurityLayer.registerPeer / getPeerKey', () => {
  it('stores and retrieves a peer key', async () => {
    const id  = await makeIdentity();
    const sec = new SecurityLayer({ identity: id });
    const peer = await makeIdentity();
    sec.registerPeer('peer-addr', peer.pubKey);
    expect(sec.getPeerKey('peer-addr')).toBe(peer.pubKey);
  });

  it('returns null for unknown address', async () => {
    const id  = await makeIdentity();
    const sec = new SecurityLayer({ identity: id });
    expect(sec.getPeerKey('unknown')).toBeNull();
  });
});

describe('encrypt / decryptAndVerify (round-trip)', () => {
  it('encrypts and decrypts an OW envelope', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();

    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobSec   = new SecurityLayer({ identity: bobId });

    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
    bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

    const env     = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { secret: 42 });
    const enc     = aliceSec.encrypt(env);

    // Ciphertext should hide the payload.
    expect(enc.payload.secret).toBeUndefined();
    expect(enc.payload._box).toBeDefined();

    const dec = bobSec.decryptAndVerify(enc);
    expect(dec.payload).toEqual({ secret: 42 });
  });

  it('HI envelope is signed but not encrypted', async () => {
    const aliceId = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobId   = await makeIdentity();
    const bobSec  = new SecurityLayer({ identity: bobId });

    bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

    const env = mkEnvelope(P.HI, aliceId.pubKey, bobId.pubKey, { pubKey: aliceId.pubKey });
    const enc = aliceSec.encrypt(env);

    // HI payload must remain plaintext.
    expect(enc.payload.pubKey).toBe(aliceId.pubKey);
    expect(enc._sig).toBeDefined();
    expect(enc._sig).not.toBeNull();

    const dec = bobSec.decryptAndVerify(enc);
    expect(dec.payload.pubKey).toBe(aliceId.pubKey);
  });

  it('HI auto-registers sender pubKey', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobSec   = new SecurityLayer({ identity: bobId });

    // Bob does not know Alice yet.
    const env = mkEnvelope(P.HI, aliceId.pubKey, bobId.pubKey, { pubKey: aliceId.pubKey });
    const enc = aliceSec.encrypt(env);

    // After verifying HI, Bob should have registered Alice.
    bobSec.decryptAndVerify(enc);
    expect(bobSec.getPeerKey(aliceId.pubKey)).toBe(aliceId.pubKey);
  });
});

describe('SecurityError — replay window', () => {
  it('rejects envelopes with _ts too far in the past', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobSec   = new SecurityLayer({ identity: bobId });
    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
    bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    const enc = aliceSec.encrypt(env);

    // Backdate the timestamp beyond the 10-minute replay window.
    const old = { ...enc, _ts: Date.now() - 11 * 60 * 1000 };
    // Signature won't match anymore — but replay check fires first.
    expect(() => bobSec.decryptAndVerify(old)).toThrow(SecurityError);
    expect(() => bobSec.decryptAndVerify(old)).toThrow(/replay window/i);
  });
});

describe('SecurityError — duplicate', () => {
  it('rejects the same envelope twice', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobSec   = new SecurityLayer({ identity: bobId });
    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
    bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    const enc = aliceSec.encrypt(env);

    bobSec.decryptAndVerify(enc);  // first: ok
    expect(() => bobSec.decryptAndVerify(enc)).toThrow(SecurityError);
    expect(() => bobSec.decryptAndVerify({ ...enc })).toThrow(/duplicate/i);
  });
});

describe('SecurityError — bad signature', () => {
  it('rejects tampered payload', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const bobSec   = new SecurityLayer({ identity: bobId });
    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
    bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);

    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    const enc = aliceSec.encrypt(env);

    // Tamper: replace the encrypted payload blob.
    const tampered = { ...enc, payload: { _box: 'AAAA' } };
    expect(() => bobSec.decryptAndVerify(tampered)).toThrow(SecurityError);
  });
});

describe('SecurityError — unknown recipient', () => {
  it('throws when encrypting for unknown peer', async () => {
    const aliceId = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    const env = mkEnvelope(P.OW, aliceId.pubKey, 'unknown-bob', { x: 1 });
    let err;
    try { aliceSec.encrypt(env); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SecurityError);
    expect(err.code).toBe(SEC.UNKNOWN_RECIPIENT);
  });
});

describe('SecurityError — unknown sender', () => {
  it('throws when verifying from unregistered peer', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const aliceSec = new SecurityLayer({ identity: aliceId });
    // Bob has NOT registered Alice.
    const bobSec   = new SecurityLayer({ identity: bobId });
    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);

    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    const enc = aliceSec.encrypt(env);

    let err;
    try { bobSec.decryptAndVerify(enc); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SecurityError);
    expect(err.code).toBe(SEC.UNKNOWN_SENDER);
  });
});

describe('end-to-end: Transport + SecurityLayer', () => {
  it('two agents exchange encrypted envelopes via InternalTransport', async () => {
    const { alice, bob, aliceId } = await makeSetup();

    const received = [];
    bob.on('envelope', e => received.push(e));

    await alice.sendOneWay(aliceId.pubKey === alice.address
      ? bob.address
      : bob.address,
      { greeting: 'secured hello' },
    );
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ greeting: 'secured hello' });
  });

  it('relay sees only ciphertext (payload has _box field, not plaintext)', async () => {
    const aliceId = await makeIdentity();
    const bobId   = await makeIdentity();
    const bus = new InternalBus();
    const alice = new InternalTransport(bus, aliceId.pubKey);
    const bob   = new InternalTransport(bus, bobId.pubKey);

    const aliceSec = new SecurityLayer({ identity: aliceId });
    aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
    alice.useSecurityLayer(aliceSec);

    await alice.connect();
    await bob.connect();

    // Intercept raw wire envelopes before SecurityLayer decrypts.
    const wireEnvelopes = [];
    bus.on(`msg:${bobId.pubKey}`, e => wireEnvelopes.push(e));

    // Bob has no security layer — wire envelope arrives raw.
    await alice.sendOneWay(bobId.pubKey, { secret: 'password123' });
    await Promise.resolve();

    expect(wireEnvelopes.length).toBeGreaterThan(0);
    // The raw wire payload should NOT contain the plaintext secret.
    expect(JSON.stringify(wireEnvelopes[0])).not.toContain('password123');
    expect(wireEnvelopes[0].payload._box).toBeDefined();
  });
});
