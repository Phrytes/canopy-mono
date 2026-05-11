/**
 * ActorResolver + PolicyEngine.actorResolver + CapabilityToken.verify
 * with resolver — unit tests (Phase 50.9 + 50.10).
 *
 * Covers:
 *   - createInMemoryActorResolver — register / resolve / revoke.
 *   - PolicyEngine accepts an injected actorResolver.
 *   - policyEngine.resolveActor(identifier) bridges pubKey / webid /
 *     agentUri.
 *   - PolicyEngine without a resolver → resolveActor returns null.
 *   - CapabilityToken.verify with matching agentId passes (no resolver
 *     needed).
 *   - CapabilityToken.verify with mismatched agentId fails without a
 *     resolver.
 *   - CapabilityToken.verify with mismatched agentId BUT resolver
 *     bridges them (URI ↔ pubKey) passes.
 *   - CapabilityToken.verifyAsync (async resolver variant).
 *
 * Strict layering: core's tests use the in-memory resolver — no
 * substrate import needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createInMemoryActorResolver,
  PolicyEngine,
  CapabilityToken,
  SkillRegistry,
  TrustRegistry,
  defineSkill,
  AgentIdentity,
  VaultMemory,
} from '@canopy/core';

/* ────────────────────────────────────────────────────────────────────────── */

describe('createInMemoryActorResolver', () => {
  it('registers + resolves by pubKey, webid, agentUri', () => {
    const r = createInMemoryActorResolver();
    const rec = {
      pubKey:   'pk-abc',
      webid:    'https://anne.example/profile#me',
      agentUri: 'https://anne.example/profile#me/agent/laptop',
      role:     'human',
    };
    r.register(rec);

    expect(r.resolve('pk-abc')).toBe(rec);
    expect(r.resolve('https://anne.example/profile#me')).toBe(rec);
    expect(r.resolve('https://anne.example/profile#me/agent/laptop')).toBe(rec);
  });

  it('returns null for unknown identifiers', () => {
    const r = createInMemoryActorResolver();
    expect(r.resolve('unknown')).toBe(null);
    expect(r.resolve('')).toBe(null);
    expect(r.resolve(null)).toBe(null);
  });

  it('revoke() sets revokedAt on the record', () => {
    const r = createInMemoryActorResolver();
    const rec = { pubKey: 'pk', webid: null, agentUri: 'urn:x', role: 'device' };
    r.register(rec);
    r.revoke('pk');
    expect(typeof rec.revokedAt).toBe('string');
  });

  it('clear() empties the resolver', () => {
    const r = createInMemoryActorResolver();
    r.register({ pubKey: 'a', webid: null, agentUri: 'urn:a', role: 'human' });
    r.register({ pubKey: 'b', webid: null, agentUri: 'urn:b', role: 'human' });
    expect(r.all()).toHaveLength(2);
    r.clear();
    expect(r.all()).toHaveLength(0);
    expect(r.resolve('a')).toBe(null);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('PolicyEngine — actorResolver injection', () => {
  let trustRegistry, skillRegistry;
  beforeEach(() => {
    trustRegistry = new TrustRegistry(new VaultMemory());
    skillRegistry = new SkillRegistry();
  });

  it('exposes resolveActor() that returns null without a resolver', async () => {
    const pe = new PolicyEngine({ trustRegistry, skillRegistry });
    expect(pe.actorResolver).toBe(null);
    expect(await pe.resolveActor('pk-abc')).toBe(null);
  });

  it('exposes the injected resolver via the getter', async () => {
    const ar = createInMemoryActorResolver();
    const pe = new PolicyEngine({ trustRegistry, skillRegistry, actorResolver: ar });
    expect(pe.actorResolver).toBe(ar);
  });

  it('resolveActor delegates to the resolver', async () => {
    const ar = createInMemoryActorResolver();
    const rec = { pubKey: 'pk-abc', webid: 'https://x', agentUri: 'urn:y', role: 'human' };
    ar.register(rec);

    const pe = new PolicyEngine({ trustRegistry, skillRegistry, actorResolver: ar });
    expect(await pe.resolveActor('pk-abc')).toBe(rec);
    expect(await pe.resolveActor('https://x')).toBe(rec);
    expect(await pe.resolveActor('urn:y')).toBe(rec);
    expect(await pe.resolveActor('not-there')).toBe(null);
  });

  it('rejects a non-resolver shape (no .resolve method) — stays null', async () => {
    const pe = new PolicyEngine({
      trustRegistry, skillRegistry,
      actorResolver: { notAResolver: true },
    });
    expect(pe.actorResolver).toBe(null);
    expect(await pe.resolveActor('anything')).toBe(null);
  });

  it('supports an async resolver', async () => {
    const asyncResolver = {
      resolve: async (id) => id === 'pk-async' ? { pubKey: 'pk-async', webid: null, agentUri: 'urn:async', role: 'bot' } : null,
    };
    const pe = new PolicyEngine({ trustRegistry, skillRegistry, actorResolver: asyncResolver });
    const r = await pe.resolveActor('pk-async');
    expect(r?.pubKey).toBe('pk-async');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('CapabilityToken.verify — resolver bridge', () => {
  let identity, alicePub;
  beforeEach(async () => {
    identity = await AgentIdentity.generate(new VaultMemory());
    alicePub = identity.pubKey;
  });

  it('passes when agentId matches literally (no resolver needed)', async () => {
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer-pk',
      agentId: alicePub,
      skill:   'echo',
      expiresIn: 60_000,
    });
    expect(CapabilityToken.verify(token, alicePub)).toBe(true);
  });

  it('fails when agentId mismatches and no resolver is supplied', async () => {
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer-pk',
      agentId: 'https://anne.example/profile#me/agent/laptop',  // URI-shaped
      skill:   'echo',
      expiresIn: 60_000,
    });
    expect(CapabilityToken.verify(token, alicePub)).toBe(false);
  });

  it('bridges URI ↔ pubKey via the resolver', async () => {
    const URI = 'https://anne.example/profile#me/agent/laptop';
    const ar  = createInMemoryActorResolver();
    ar.register({
      pubKey:   alicePub,
      webid:    'https://anne.example/profile#me',
      agentUri: URI,
      role:     'human',
    });

    // Token has the URI-shape agentId; we expect the pubKey (legacy
    // caller). Resolver bridges.
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer-pk',
      agentId: URI,
      skill:   'echo',
      expiresIn: 60_000,
    });

    expect(CapabilityToken.verify(token, alicePub, { actorResolver: ar })).toBe(true);

    // And the inverse: token has pubKey-shape agentId, caller expects URI.
    const tokenLegacy = await CapabilityToken.issue(identity, {
      subject: 'peer-pk',
      agentId: alicePub,
      skill:   'echo',
      expiresIn: 60_000,
    });
    expect(CapabilityToken.verify(tokenLegacy, URI, { actorResolver: ar })).toBe(true);
  });

  it('rejects when neither side resolves', async () => {
    const ar = createInMemoryActorResolver();   // empty
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer-pk',
      agentId: 'https://other/agent',
      skill:   'echo',
      expiresIn: 60_000,
    });
    expect(CapabilityToken.verify(token, alicePub, { actorResolver: ar })).toBe(false);
  });

  it('rejects when records resolve to different pubKeys', async () => {
    const ar = createInMemoryActorResolver();
    ar.register({ pubKey: 'pk-a', webid: null, agentUri: 'urn:a', role: 'human' });
    ar.register({ pubKey: 'pk-b', webid: null, agentUri: 'urn:b', role: 'human' });

    const token = await CapabilityToken.issue(identity, {
      subject: 'peer',
      agentId: 'urn:a',
      skill:   'echo',
      expiresIn: 60_000,
    });
    expect(CapabilityToken.verify(token, 'urn:b', { actorResolver: ar })).toBe(false);
  });

  it('still rejects expired tokens regardless of resolver', async () => {
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer',
      agentId: alicePub,
      skill:   'echo',
      expiresIn: -1,                              // already expired
    });
    const ar = createInMemoryActorResolver();
    expect(CapabilityToken.verify(token, alicePub, { actorResolver: ar })).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('CapabilityToken.verifyAsync — async resolver', () => {
  it('awaits an async resolver to bridge URI ↔ pubKey', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const alicePub = identity.pubKey;
    const URI      = 'https://anne.example/profile#me/agent/laptop';
    const record   = { pubKey: alicePub, webid: 'https://anne.example/profile#me', agentUri: URI, role: 'human' };

    const asyncResolver = {
      resolve: async (id) => (id === alicePub || id === URI || id === record.webid) ? record : null,
    };

    const token = await CapabilityToken.issue(identity, {
      subject: 'peer',
      agentId: URI,
      skill:   'echo',
      expiresIn: 60_000,
    });

    const ok = await CapabilityToken.verifyAsync(token, alicePub, { actorResolver: asyncResolver });
    expect(ok).toBe(true);
  });

  it('async-rejects on no resolver when ids differ', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const token = await CapabilityToken.issue(identity, {
      subject: 'peer',
      agentId: 'urn:something',
      skill:   'echo',
      expiresIn: 60_000,
    });
    const ok = await CapabilityToken.verifyAsync(token, 'urn:other-thing');
    expect(ok).toBe(false);
  });
});
