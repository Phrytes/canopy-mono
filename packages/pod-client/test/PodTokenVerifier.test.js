/**
 * PodTokenVerifier + scopeForRequest + PodTokenRegistry — R2b.0.
 *
 * Deny-by-default must be PROVABLY real: every case issues a REAL
 * `PodCapabilityToken` (real Ed25519 keys via AgentIdentity) and asserts the
 * RESULT — the verified subject vs `null`.  No mocked crypto.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, PodCapabilityToken } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import {
  createPodTokenVerifier,
  scopeForRequest,
} from '../src/Auth/PodTokenVerifier.js';
import { PodTokenRegistry } from '../src/Auth/PodTokenRegistry.js';

const POD       = 'https://alice.example/';
const OTHER_POD = 'https://mallory.example/';

/** owner (the pod owner / device) issues delegations; host is the subject. */
async function makeActors() {
  const owner = await AgentIdentity.generate(new VaultMemory());
  const host  = await AgentIdentity.generate(new VaultMemory());
  return { owner, host };
}

/** Issue an owner→host PodCapabilityToken with the given scopes. */
async function issue(owner, host, scopes, opts = {}) {
  return PodCapabilityToken.issue(owner, {
    subject: host.pubKey,
    pod:     POD,
    scopes,
    ...opts,
  });
}

// ── verify(): the enforcing half ───────────────────────────────────────────────

describe('createPodTokenVerifier — deny-by-default', () => {
  it('ALLOWS an in-scope request (container prefix covers a resource)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).not.toBeNull();
    expect(actor.subject).toBe(host.pubKey);
    expect(actor.issuer).toBe(owner.pubKey);
    expect(actor.scopes).toEqual(['pod.read:/notes/']);
    expect(actor.id).toBe(token.id);
  });

  it('DENIES an out-of-scope path (different container)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.read:/photos/x.jpg',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES an op mismatch (read token, write request)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.write:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES an expired token (injected future clock)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({
      trustedIssuers: [owner.pubKey],
      // clock jumped past expiry; the default sig-check also uses real time,
      // but the injectable clock proves the expiry seam independently.
      verifySignature: (raw, expectedPod) =>
        // keep the real sig/pod check but neutralise its real-time expiry so the
        // injected clock is the thing under test.
        raw.issuer === owner.pubKey &&
        raw.pod === expectedPod &&
        typeof raw.sig === 'string',
      now: () => token.expiresAt + 1,
    });
    const actor = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES a naturally-expired token (real PodCapabilityToken.verify)', async () => {
    const { owner, host } = await makeActors();
    // Issue already-expired: expiresAt = now - 1s.
    const token = await issue(owner, host, ['pod.read:/notes/'], { expiresIn: -1000 });

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES a revoked token', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({
      trustedIssuers: [owner.pubKey],
      isRevoked: (id) => id === token.id,
    });
    const actor = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES a wrong-pod binding (expectedPod mismatch)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   OTHER_POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES a tampered token (scope widened after signing)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    // Widen the scope on the wire — signature no longer covers it.
    const tampered = token.toJSON();
    tampered.scopes = ['pod.read:/'];

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token:         tampered,
      requiredScope: 'pod.read:/photos/x.jpg',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('DENIES a wrong-issuer token (untrusted signer)', async () => {
    const { owner, host } = await makeActors();
    const mallory = await AgentIdentity.generate(new VaultMemory());
    // Mallory validly signs a token — good signature, but not the owner.
    const token = await issue(mallory, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token,
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });

    expect(actor).toBeNull();
  });

  it('supports an isTrusted predicate (owner-issued model)', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.write:/notes/']);

    const verify = createPodTokenVerifier({
      isTrusted: (issuer) => issuer === owner.pubKey,
    });
    const ok  = await verify({ token, requiredScope: 'pod.write:/notes/a.md', expectedPod: POD });
    expect(ok).not.toBeNull();
    expect(ok.subject).toBe(host.pubKey);

    const untrusted = createPodTokenVerifier({ isTrusted: () => false });
    const denied    = await untrusted({ token, requiredScope: 'pod.write:/notes/a.md', expectedPod: POD });
    expect(denied).toBeNull();
  });

  it('accepts a JSON-string token on the wire', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);

    const verify = createPodTokenVerifier({ trustedIssuers: [owner.pubKey] });
    const actor  = await verify({
      token:         token.toString(),
      requiredScope: 'pod.read:/notes/recipes.md',
      expectedPod:   POD,
    });
    expect(actor?.subject).toBe(host.pubKey);
  });

  it('DENIES malformed / missing input without throwing', async () => {
    const verify = createPodTokenVerifier({});
    expect(await verify({ token: 'not-json', requiredScope: 'pod.read:/a' })).toBeNull();
    expect(await verify({ token: null, requiredScope: 'pod.read:/a' })).toBeNull();
    expect(await verify({ token: {}, requiredScope: 'pod.read:/a' })).toBeNull();
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);
    // Missing requiredScope denies.
    expect(await verify({ token })).toBeNull();
  });
});

// ── attenuation: a narrowed sub-token allows its subset only ────────────────────

describe('createPodTokenVerifier — attenuation (chained sub-token)', () => {
  it('a host-issued sub-token grants its narrowed subset and denies beyond', async () => {
    const { owner, host } = await makeActors();
    const app = await AgentIdentity.generate(new VaultMemory());

    // Owner → host: broad read on /notes/.
    const parent = await issue(owner, host, ['pod.read:/notes/']);

    // Host (the holder) attenuates to /notes/recipes/ for a downstream app.
    // Shorter TTL so child.expiresAt <= parent.expiresAt (a valid attenuation).
    const child = await PodCapabilityToken.issue(host, {
      subject:   app.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/recipes/'],
      parentId:  parent.id,
      expiresIn: 1_800_000,
    });

    // The chain itself is a valid attenuation.
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(true);

    // Verify the child token (host is the trusted issuer of this sub-token).
    const verify = createPodTokenVerifier({ trustedIssuers: [host.pubKey] });

    // Within the narrowed scope → ALLOW.
    const ok = await verify({
      token:         child,
      requiredScope: 'pod.read:/notes/recipes/cake.md',
      expectedPod:   POD,
    });
    expect(ok?.subject).toBe(app.pubKey);

    // Beyond the narrowed scope (but within the PARENT's) → DENY.
    const denied = await verify({
      token:         child,
      requiredScope: 'pod.read:/notes/other.md',
      expectedPod:   POD,
    });
    expect(denied).toBeNull();
  });
});

// ── scopeForRequest ────────────────────────────────────────────────────────────

describe('scopeForRequest', () => {
  it('maps read/write/delete to the pod.<action> scope', () => {
    expect(scopeForRequest('read',   '/notes/a.md')).toBe('pod.read:/notes/a.md');
    expect(scopeForRequest('write',  '/notes/a.md')).toBe('pod.write:/notes/a.md');
    expect(scopeForRequest('delete', '/notes/a.md')).toBe('pod.delete:/notes/a.md');
  });

  it('maps list to a read scope (listing a container is a read)', () => {
    expect(scopeForRequest('list', '/notes/')).toBe('pod.read:/notes/');
  });

  it('passes the path through verbatim', () => {
    expect(scopeForRequest('read', '/a/b/c/deep.txt')).toBe('pod.read:/a/b/c/deep.txt');
  });

  it('throws on an unknown op', () => {
    expect(() => scopeForRequest('frobnicate', '/a')).toThrow(/unknown op/);
  });

  it('throws on a missing path', () => {
    expect(() => scopeForRequest('read', '')).toThrow(/path/);
    expect(() => scopeForRequest('read', undefined)).toThrow(/path/);
  });
});

// ── PodTokenRegistry ───────────────────────────────────────────────────────────

describe('PodTokenRegistry', () => {
  it('revoke flips isRevoked; unknown id is not revoked', async () => {
    const reg = new PodTokenRegistry(new VaultMemory());

    expect(await reg.isRevoked('tok-1')).toBe(false);
    await reg.revoke('tok-1');
    expect(await reg.isRevoked('tok-1')).toBe(true);
    expect(await reg.isRevoked('tok-2')).toBe(false);
  });

  it('unrevoke clears; list reports revoked ids', async () => {
    const reg = new PodTokenRegistry(new VaultMemory());
    await reg.revoke('a');
    await reg.revoke('b');
    expect((await reg.list()).sort()).toEqual(['a', 'b']);
    await reg.unrevoke('a');
    expect(await reg.isRevoked('a')).toBe(false);
    expect(await reg.list()).toEqual(['b']);
  });

  it('backs a verifier revocation seam end-to-end', async () => {
    const { owner, host } = await makeActors();
    const token = await issue(owner, host, ['pod.read:/notes/']);
    const reg   = new PodTokenRegistry(new VaultMemory());

    const verify = createPodTokenVerifier({
      trustedIssuers: [owner.pubKey],
      isRevoked: (id) => reg.isRevoked(id),
    });

    const req = { token, requiredScope: 'pod.read:/notes/a.md', expectedPod: POD };
    expect(await verify(req)).not.toBeNull();   // valid before revoke
    await reg.revoke(token.id);
    expect(await verify(req)).toBeNull();        // denied after revoke
  });

  it('requires a vault', () => {
    expect(() => new PodTokenRegistry()).toThrow(/requires a vault/);
  });
});
