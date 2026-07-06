// resourceKeyGrantAcl.test.js — objective S: the deferred POD-SIDE ACL WIRING for per-resource CEK grants.
//
// The per-resource CEK grant (resourceKeyGrant.js) is the KEY-CUSTODY layer: a CapabilityToken-gated broker
// hands over a resource's key. On its own the pod does NOT enforce that grant — a holder of the resource URI
// could fetch ciphertext even without an ACP grant (defence-in-depth missing). This wires it: an INJECTED
// `sharing` ACP surface is paired with the key layer, EXACTLY as `createCanonicalShare` pairs grantMember
// with sharing.grant. Grant → key handover + `sharing.grant`; revoke → key revocation + `sharing.revoke`.
//
// Hermetic + injected — real crypto for the key layer (real X25519 sealing keypairs, real Ed25519 identities,
// real signed CapabilityTokens, real vault-backed TokenRegistry) + a FAKE `sharing` ACP that records
// grants/revokes in memory and honours the SHARING_REVOKE_NOOP contract. NO live pod / network.
import { describe, it, expect, vi } from 'vitest';
import {
  createResourceKeyGrant, openGrantedResource,
  generateKeypair, isSealed,
} from '../src/sealing/index.js';
import { AgentIdentity, CapabilityToken, TokenRegistry } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

// Fake ACP surface — mirrors canonicalShare.test's fake. grant/revoke mutate an in-memory table; a
// `noopRevoke` flag makes revoke THROW a SHARING_REVOKE_NOOP-coded error exactly as the real client.sharing
// does when the SDK applies no change (verified 2026-05-16).
function fakeSharing({ noopRevoke = false } = {}) {
  const table = {};   // resourceUri → Set(agent)
  const grants = []; const revokes = [];
  const key = (uri) => (table[uri] ||= new Set());
  return {
    table, grants, revokes,
    has: (uri, agent) => key(uri).has(agent),
    grant: vi.fn(async ({ resourceUri, agent, modes }) => { key(resourceUri).add(agent); grants.push({ resourceUri, agent, modes }); return { resourceUri, agent }; }),
    revoke: vi.fn(async ({ resourceUri, agent, modes }) => {
      if (noopRevoke) { const e = new Error('client.sharing.revoke: applied no change'); e.code = 'SHARING_REVOKE_NOOP'; throw e; }
      key(resourceUri).delete(agent); revokes.push({ resourceUri, agent, modes }); return { resourceUri, agent };
    }),
  };
}

async function setup({ sharing = null, checkGrant = null } = {}) {
  const custodian = await AgentIdentity.generate(new VaultMemory());
  const tokenRegistry = new TokenRegistry(new VaultMemory());
  const broker = createResourceKeyGrant({ identity: custodian, tokenRegistry, sharing, checkGrant });
  const a = broker.sealResource('resA', 'secret-A: the launch codes');
  const b = broker.sealResource('resB', 'secret-B: the other thing');
  return { custodian, tokenRegistry, broker, a, b };
}

describe('resourceKeyGrant — pod-side ACL wiring (injected sharing) pairs key custody with an ACP grant', () => {
  it('grant: hands over the key AND records an ACP read-grant for the grantee on that resource; grantee opens', async () => {
    const sharing = fakeSharing();
    const { broker, a } = await setup({ sharing });
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    const res = await broker.releaseKey({
      token,
      requesterPubKey:     holderId.pubKey,
      resourceId:          'resA',
      requesterSealPubKey: holderSeal.publicKey,
      agent:               'did:holder',   // ACP subject (WebID) distinct from the sealing key
    });

    // KEY handed over — grantee opens the sealed body.
    expect(res.denied).toBeUndefined();
    expect(isSealed(res.wrappedKey)).toBe(true);
    const plaintext = openGrantedResource({ wrappedKey: res.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: a.sealed });
    expect(plaintext).toBe('secret-A: the launch codes');

    // ACP grant landed for the grantee on resA with read.
    expect(sharing.grant).toHaveBeenCalledOnce();
    expect(sharing.grant.mock.calls[0][0]).toMatchObject({ resourceUri: 'resA', agent: 'did:holder', modes: ['read'] });
    expect(sharing.has('resA', 'did:holder')).toBe(true);
  });

  it('revoke: revokes the key (future releaseKey denied) AND records an ACP revoke — grantee denied BOTH ways', async () => {
    const sharing = fakeSharing();
    const { broker, tokenRegistry } = await setup({ sharing });
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    await broker.releaseKey({ token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey, agent: 'did:holder' });
    expect(sharing.has('resA', 'did:holder')).toBe(true);

    // Revoke via the OBJECT form so the ACP is revoked alongside the key.
    await broker.revoke({ tokenId: token.id, resourceId: 'resA', agent: 'did:holder' });

    // KEY custody: token is revoked, future releaseKey is denied.
    expect(await tokenRegistry.isRevoked(token.id)).toBe(true);
    const after = await broker.releaseKey({ token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey, agent: 'did:holder' });
    expect(after.wrappedKey).toBeUndefined();
    expect(after.reason).toBe('revoked');

    // ACP: the pod now denies the grantee the resource.
    expect(sharing.revoke).toHaveBeenCalledOnce();
    expect(sharing.revoke.mock.calls[0][0]).toMatchObject({ resourceUri: 'resA', agent: 'did:holder', modes: ['read'] });
    expect(sharing.has('resA', 'did:holder')).toBe(false);
  });

  it('gate is AUTHORITATIVE: a token-denied release lands NO ACP grant and hands over NO key', async () => {
    const sharing = fakeSharing();
    const { broker } = await setup({ sharing });
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    // A token scoped to resB, presented against resA — the scope check denies it.
    const tokenB = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resB' });
    const res = await broker.releaseKey({
      token: tokenB, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey, agent: 'did:holder',
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.denied).toBe(true);
    expect(res.reason).toBe('wrong-scope');
    // The ACP was NOT touched — the gate rejected before any pod-side reflection.
    expect(sharing.grant).not.toHaveBeenCalled();
    expect(sharing.has('resA', 'did:holder')).toBe(false);
  });

  it('gate is AUTHORITATIVE: a checkGrant (pod ACL) denial lands NO ACP grant and no key', async () => {
    const sharing = fakeSharing();
    const { broker } = await setup({ sharing, checkGrant: async () => false });
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    const res = await broker.releaseKey({ token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey, agent: 'did:holder' });
    expect(res.reason).toBe('acl');
    expect(sharing.grant).not.toHaveBeenCalled();
  });

  it('ISOLATION: granting/revoking resource A does not touch resource B', async () => {
    const sharing = fakeSharing();
    const { broker } = await setup({ sharing });
    const h = await AgentIdentity.generate(new VaultMemory());
    const seal = generateKeypair();

    const tA = await broker.issueGrant({ subject: h.pubKey, resourceId: 'resA' });
    const tB = await broker.issueGrant({ subject: h.pubKey, resourceId: 'resB' });
    await broker.releaseKey({ token: tA, requesterPubKey: h.pubKey, resourceId: 'resA', requesterSealPubKey: seal.publicKey, agent: 'did:holder' });
    await broker.releaseKey({ token: tB, requesterPubKey: h.pubKey, resourceId: 'resB', requesterSealPubKey: seal.publicKey, agent: 'did:holder' });
    expect(sharing.has('resA', 'did:holder')).toBe(true);
    expect(sharing.has('resB', 'did:holder')).toBe(true);

    // Revoke ONLY A's grant → A's ACP denied, B's ACP untouched.
    await broker.revoke({ tokenId: tA.id, resourceId: 'resA', agent: 'did:holder' });
    expect(sharing.has('resA', 'did:holder')).toBe(false);
    expect(sharing.has('resB', 'did:holder')).toBe(true);
    expect(sharing.revoke.mock.calls[0][0]).toMatchObject({ resourceUri: 'resA' });
  });

  it('SHARING_REVOKE_NOOP: a no-op ACP revoke PROPAGATES (never silently "succeeds")', async () => {
    const sharing = fakeSharing({ noopRevoke: true });
    const { broker, tokenRegistry } = await setup({ sharing });
    const h = await AgentIdentity.generate(new VaultMemory());
    const seal = generateKeypair();
    const token = await broker.issueGrant({ subject: h.pubKey, resourceId: 'resA' });
    await broker.releaseKey({ token, requesterPubKey: h.pubKey, resourceId: 'resA', requesterSealPubKey: seal.publicKey, agent: 'did:holder' });

    await expect(broker.revoke({ tokenId: token.id, resourceId: 'resA', agent: 'did:holder' }))
      .rejects.toMatchObject({ code: 'SHARING_REVOKE_NOOP' });
    // Key custody still revoked FIRST (fail-safe) — the grantee is already denied the key even though ACP threw.
    expect(await tokenRegistry.isRevoked(token.id)).toBe(true);
  });

  it('resourceUriFor maps the internal resourceId → the pod resource URI the ACP targets', async () => {
    const sharing = fakeSharing();
    const custodian = await AgentIdentity.generate(new VaultMemory());
    const broker = createResourceKeyGrant({
      identity: custodian, sharing,
      resourceUriFor: (id) => `https://alice.pod/circles/A/items/${id}.json`,
    });
    broker.sealResource('resA', 'body');
    const h = await AgentIdentity.generate(new VaultMemory());
    const seal = generateKeypair();
    const token = await broker.issueGrant({ subject: h.pubKey, resourceId: 'resA' });
    await broker.releaseKey({ token, requesterPubKey: h.pubKey, resourceId: 'resA', requesterSealPubKey: seal.publicKey, agent: 'did:holder' });
    expect(sharing.has('https://alice.pod/circles/A/items/resA.json', 'did:holder')).toBe(true);
  });

  it('validates an injected sharing surface', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    expect(() => createResourceKeyGrant({ identity, sharing: {} })).toThrow(/sharing must expose grant\/revoke/);
    expect(() => createResourceKeyGrant({ identity, resourceUriFor: 'nope' })).toThrow(/resourceUriFor must be a function/);
  });
});

describe('resourceKeyGrant — BACK-COMPAT: no sharing injected ⇒ key-only, exactly as before', () => {
  it('grant hands over the key with NO ACP call; agent defaults are ignored', async () => {
    const { broker, a } = await setup();   // no sharing
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();
    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    const res = await broker.releaseKey({ token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey });
    expect(isSealed(res.wrappedKey)).toBe(true);
    expect(openGrantedResource({ wrappedKey: res.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: a.sealed })).toBe('secret-A: the launch codes');
  });

  it('string-form revoke still revokes the token (no ACP surface needed)', async () => {
    const { broker, tokenRegistry } = await setup();   // no sharing
    const holderId = await AgentIdentity.generate(new VaultMemory());
    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    await broker.revoke(token.id);
    expect(await tokenRegistry.isRevoked(token.id)).toBe(true);
  });
});
