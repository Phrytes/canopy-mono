import { describe, it, expect }      from 'vitest';
import { PodCapabilityToken }        from '../../src/permissions/PodCapabilityToken.js';
import { AgentIdentity }             from '../../src/identity/AgentIdentity.js';
import { VaultMemory }                from '@canopy/vault';

const POD = 'https://alice.example/';

// ── issue / verify ────────────────────────────────────────────────────────────

describe('PodCapabilityToken — issue / verify', () => {
  it('issues a token with the spec wire-format fields', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob-pubkey',
      pod:     POD,
      scopes:  ['pod.read:/notes/'],
    });

    const json = tok.toJSON();
    expect(typeof json.id).toBe('string');
    expect(json.issuer).toBe(id.pubKey);
    expect(json.subject).toBe('bob-pubkey');
    expect(json.pod).toBe(POD);
    expect(json.scopes).toEqual(['pod.read:/notes/']);
    expect(typeof json.issuedAt).toBe('number');
    expect(typeof json.expiresAt).toBe('number');
    expect(json.expiresAt).toBeGreaterThan(json.issuedAt);
    expect(typeof json.sig).toBe('string');
    // Defaults: no constraints, no parentId.
    expect(json.constraints).toBeUndefined();
    expect(json.parentId).toBeUndefined();
  });

  it('verifies a freshly-issued token', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob',
      pod:     POD,
      scopes:  ['pod.read:/notes/', 'pod.write:/notes/foo.md'],
    });
    expect(PodCapabilityToken.verify(tok)).toBe(true);
    expect(PodCapabilityToken.verify(tok, POD)).toBe(true);
  });

  it('rejects when expectedPod does not match', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob',
      pod:     POD,
      scopes:  ['pod.read:/notes/'],
    });
    expect(PodCapabilityToken.verify(tok, 'https://other.example/')).toBe(false);
  });

  it('round-trips through JSON', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.*:/notes/'],
    });
    const rt = PodCapabilityToken.fromJSON(tok.toJSON());
    expect(PodCapabilityToken.verify(rt)).toBe(true);
    expect(rt.scopes).toEqual(['pod.*:/notes/']);
    expect(rt.pod).toBe(POD);
  });

  it('toString round-trip via JSON.parse + fromJSON', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const rt = PodCapabilityToken.fromJSON(tok.toString());
    expect(PodCapabilityToken.verify(rt)).toBe(true);
  });

  it('preserves optional constraints and parentId', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject:     'bob',
      pod:         POD,
      scopes:      ['pod.read:/notes/'],
      constraints: { rateLimit: 100 },
      parentId:    'parent-uuid',
    });
    expect(tok.constraints).toEqual({ rateLimit: 100 });
    expect(tok.parentId).toBe('parent-uuid');
    expect(PodCapabilityToken.verify(tok)).toBe(true);
  });

  it('rejects required-opts misuse', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    await expect(PodCapabilityToken.issue(id, { pod: POD, scopes: ['pod.read:/'] }))
      .rejects.toThrow();
    await expect(PodCapabilityToken.issue(id, { subject: 'b', scopes: ['pod.read:/'] }))
      .rejects.toThrow();
    await expect(PodCapabilityToken.issue(id, { subject: 'b', pod: POD, scopes: [] }))
      .rejects.toThrow();
  });
});

// ── expiry ────────────────────────────────────────────────────────────────────

describe('PodCapabilityToken — expiry', () => {
  it('rejects expired token', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject:   'bob',
      pod:       POD,
      scopes:    ['pod.read:/notes/'],
      expiresIn: -1,   // already expired
    });
    expect(PodCapabilityToken.verify(tok)).toBe(false);
    expect(tok.isExpired).toBe(true);
  });
});

// ── signature failure / tampering ────────────────────────────────────────────

describe('PodCapabilityToken — tampering', () => {
  it('detects scope tampering', async () => {
    const id   = await AgentIdentity.generate(new VaultMemory());
    const tok  = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const json = tok.toJSON();
    // Attacker widens scope after issuance.
    json.scopes = ['pod.*:/'];
    expect(PodCapabilityToken.verify(json)).toBe(false);
  });

  it('detects subject tampering', async () => {
    const id   = await AgentIdentity.generate(new VaultMemory());
    const tok  = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const json = tok.toJSON();
    json.subject = 'mallory';
    expect(PodCapabilityToken.verify(json)).toBe(false);
  });

  it('detects expiry tampering', async () => {
    const id   = await AgentIdentity.generate(new VaultMemory());
    const tok  = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const json = tok.toJSON();
    json.expiresAt = json.expiresAt + 10_000_000;   // try to extend
    expect(PodCapabilityToken.verify(json)).toBe(false);
  });

  it('detects pod tampering', async () => {
    const id   = await AgentIdentity.generate(new VaultMemory());
    const tok  = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const json = tok.toJSON();
    json.pod = 'https://attacker.example/';
    expect(PodCapabilityToken.verify(json)).toBe(false);
  });

  it('detects signature substitution from a different issuer', async () => {
    const idA = await AgentIdentity.generate(new VaultMemory());
    const idB = await AgentIdentity.generate(new VaultMemory());
    const tokA = await PodCapabilityToken.issue(idA, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const tokB = await PodCapabilityToken.issue(idB, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const json = tokA.toJSON();
    // Steal B's signature; A's payload won't verify under either key.
    json.sig = tokB.toJSON().sig;
    expect(PodCapabilityToken.verify(json)).toBe(false);
  });

  it('returns false for missing/invalid sig', () => {
    expect(PodCapabilityToken.verify({})).toBe(false);
    expect(PodCapabilityToken.verify({ expiresAt: Date.now() + 1000 })).toBe(false);
  });
});

// ── scope matching ────────────────────────────────────────────────────────────

describe('PodCapabilityToken.matchesScope', () => {
  it('container scope matches a child resource', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.read:/notes/foo.md',
    )).toBe(true);
  });

  it('container scope matches deeply-nested resource', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.read:/notes/sub/dir/x.md',
    )).toBe(true);
  });

  it('container scope does NOT match a sibling container', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.read:/photos/',
    )).toBe(false);
  });

  it('container scope does NOT match a path that only shares a prefix segment', () => {
    // /notes/  must not match /notesX/foo.md  — trailing slash makes the
    // boundary explicit.
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.read:/notesX/foo.md',
    )).toBe(false);
  });

  it('pod.* covers read, write, and delete on the same prefix', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.*:/notes/',
      'pod.read:/notes/foo.md',
    )).toBe(true);
    expect(PodCapabilityToken.matchesScope(
      'pod.*:/notes/',
      'pod.write:/notes/foo.md',
    )).toBe(true);
    expect(PodCapabilityToken.matchesScope(
      'pod.*:/notes/',
      'pod.delete:/notes/foo.md',
    )).toBe(true);
  });

  it('pod.read does NOT cover pod.write on the same prefix', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.write:/notes/foo.md',
    )).toBe(false);
  });

  it('resource scope (no trailing slash) matches only exact path', () => {
    // Per spec interpretation: "trailing slash required for container-level
    // scopes" → without it, the scope is for that exact resource only.
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/foo.md',
      'pod.read:/notes/foo.md',
    )).toBe(true);
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/foo.md',
      'pod.read:/notes/foo.md.bak',
    )).toBe(false);
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/note',
      'pod.read:/note/foo.md',
    )).toBe(false);
  });

  it('rejects unknown action prefixes', () => {
    expect(PodCapabilityToken.matchesScope(
      'pod.exec:/scripts/',
      'pod.exec:/scripts/run.sh',
    )).toBe(false);
    expect(PodCapabilityToken.matchesScope(
      'agent.read:/notes/',
      'pod.read:/notes/foo.md',
    )).toBe(false);
  });

  it('rejects malformed scope strings', () => {
    expect(PodCapabilityToken.matchesScope('not-a-scope', 'pod.read:/notes/')).toBe(false);
    expect(PodCapabilityToken.matchesScope('pod.read:/notes/', 'not-a-scope')).toBe(false);
    expect(PodCapabilityToken.matchesScope('', '')).toBe(false);
    expect(PodCapabilityToken.matchesScope('pod.:/notes/', 'pod.read:/notes/foo.md')).toBe(false);
  });

  it('required pod.* on a resource is not covered by a single concrete grant', () => {
    // Asking for "all actions" on a resource needs pod.* on the granted side.
    expect(PodCapabilityToken.matchesScope(
      'pod.read:/notes/',
      'pod.*:/notes/foo.md',
    )).toBe(false);
  });
});

// ── chain attenuation ────────────────────────────────────────────────────────

describe('PodCapabilityToken.verifyChain', () => {
  it('verifies a single-link chain', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    expect(PodCapabilityToken.verifyChain([tok])).toBe(true);
  });

  it('verifies a properly attenuated parent → child chain', async () => {
    // Parent: alice grants bob read+write on /notes/
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.*:/notes/'],
      expiresIn: 60_000,
    });

    // Child: bob delegates a narrower scope to carol with shorter expiry.
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol-pubkey',
      pod:       POD,
      scopes:    ['pod.read:/notes/foo.md'],
      expiresIn: 30_000,
      parentId:  parent.id,
    });

    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(true);
  });

  it('rejects a chain whose child widens scope beyond parent', async () => {
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/'],         // read only
      expiresIn: 60_000,
    });
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol',
      pod:       POD,
      scopes:    ['pod.write:/notes/foo.md'],  // tries to add write
      expiresIn: 30_000,
      parentId:  parent.id,
    });
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(false);
  });

  it('rejects a chain whose child reaches outside parent prefix', async () => {
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/'],
      expiresIn: 60_000,
    });
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol',
      pod:       POD,
      scopes:    ['pod.read:/photos/cat.jpg'],
      expiresIn: 30_000,
      parentId:  parent.id,
    });
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(false);
  });

  it('rejects a chain whose child outlives parent', async () => {
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/'],
      expiresIn: 30_000,
    });
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol',
      pod:       POD,
      scopes:    ['pod.read:/notes/foo.md'],
      expiresIn: 60_000,                       // longer than parent
      parentId:  parent.id,
    });
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(false);
  });

  it('rejects a chain with a different pod between parent and child', async () => {
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/'],
      expiresIn: 60_000,
    });
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol',
      pod:       'https://other.example/',
      scopes:    ['pod.read:/notes/foo.md'],
      expiresIn: 30_000,
      parentId:  parent.id,
    });
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(false);
  });

  it('rejects a chain whose child does not reference parent.id', async () => {
    const alice  = await AgentIdentity.generate(new VaultMemory());
    const bob    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(alice, {
      subject:   bob.pubKey,
      pod:       POD,
      scopes:    ['pod.read:/notes/'],
      expiresIn: 60_000,
    });
    const child = await PodCapabilityToken.issue(bob, {
      subject:   'carol',
      pod:       POD,
      scopes:    ['pod.read:/notes/foo.md'],
      expiresIn: 30_000,
      // parentId intentionally omitted
    });
    expect(PodCapabilityToken.verifyChain([parent, child])).toBe(false);
  });

  it('rejects on empty / non-array input', () => {
    expect(PodCapabilityToken.verifyChain([])).toBe(false);
    expect(PodCapabilityToken.verifyChain(null)).toBe(false);
    expect(PodCapabilityToken.verifyChain('not a chain')).toBe(false);
  });

  it('rejects when any link fails to verify', async () => {
    const id  = await AgentIdentity.generate(new VaultMemory());
    const tok = await PodCapabilityToken.issue(id, {
      subject: 'bob', pod: POD, scopes: ['pod.read:/notes/'],
    });
    const tampered = tok.toJSON();
    tampered.scopes = ['pod.*:/'];
    expect(PodCapabilityToken.verifyChain([tampered])).toBe(false);
  });
});
