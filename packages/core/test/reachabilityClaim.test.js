/**
 * reachabilityClaim — sign/verify helpers for the oracle bridge model.
 * See Design-v3/oracle-bridge-selection.md §2, §5; CODING-PLAN.md Group T2.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  signReachabilityClaim,
  verifyReachabilityClaim,
  createMemorySeqStore,
  CLAIM_VERSION,
}                               from '../src/security/reachabilityClaim.js';
import { AgentIdentity }        from '../src/identity/AgentIdentity.js';
import { VaultMemory }          from '../src/identity/VaultMemory.js';

async function freshIdentity() {
  return AgentIdentity.generate(new VaultMemory());
}

describe('reachabilityClaim — sign / verify round-trip', () => {
  it('signs and verifies a valid claim', async () => {
    const id    = await freshIdentity();
    const peers = ['pkA', 'pkB', 'pkC'];
    const seqStore = createMemorySeqStore(0);

    const claim = await signReachabilityClaim(id, peers, { ttlMs: 60_000, seqStore });

    expect(claim.body.v).toBe(CLAIM_VERSION);
    expect(claim.body.i).toBe(id.pubKey);
    expect(claim.body.p).toEqual(['pkA', 'pkB', 'pkC']);
    expect(claim.body.t).toBe(60_000);
    expect(typeof claim.body.s).toBe('number');
    expect(typeof claim.sig).toBe('string');

    const result = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(result.ok).toBe(true);
    expect(result.newLastSeq).toBe(claim.body.s);
  });

  it('sorts peer pubkeys in the signed body (determinism)', async () => {
    const id = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['zulu', 'alpha', 'mike'], { ttlMs: 1000 });
    expect(claim.body.p).toEqual(['alpha', 'mike', 'zulu']);
  });
});

describe('reachabilityClaim — tampering', () => {
  it('rejects a tampered `p` (peers list)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    claim.body.p = ['pkA', 'pkEVIL'];  // must stay sorted so the sort-check doesn't fail first
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects a tampered `t` (ttl)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    claim.body.t = 60_000;
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects a tampered `s` (sequence)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    claim.body.s = claim.body.s + 1;
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects a tampered `i` (issuer pubkey)', async () => {
    const id    = await freshIdentity();
    const other = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    claim.body.i = other.pubKey;
    // Now expected must match what's in the body, else we hit "issuer mismatch".
    const res = verifyReachabilityClaim(claim, { expectedIssuer: other.pubKey });
    expect(res.ok).toBe(false);
    // Either reason (mismatch or bad sig) is acceptable — the claim is rejected.
    expect(res.reason).toMatch(/bad signature|issuer mismatch/);
  });
});

describe('reachabilityClaim — reflection guard', () => {
  it('rejects when the declared issuer differs from expectedIssuer', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: 'SOME_OTHER_PUBKEY' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/issuer mismatch/);
  });
});

describe('reachabilityClaim — replay guard', () => {
  it('accepts a first-time claim (no lastSeenSeq)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(true);
  });

  it('accepts a strictly newer claim', async () => {
    const id   = await freshIdentity();
    const seq  = createMemorySeqStore(0);
    const c1   = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore: seq });
    const c2   = await signReachabilityClaim(id, ['pkA', 'pkB'], { ttlMs: 1000, seqStore: seq });

    expect(c2.body.s).toBeGreaterThan(c1.body.s);

    const r1 = verifyReachabilityClaim(c1, { expectedIssuer: id.pubKey });
    expect(r1.ok).toBe(true);

    const r2 = verifyReachabilityClaim(c2, {
      expectedIssuer: id.pubKey,
      lastSeenSeq:    r1.newLastSeq,
    });
    expect(r2.ok).toBe(true);
    expect(r2.newLastSeq).toBe(c2.body.s);
  });

  it('rejects replay (s === lastSeenSeq)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, {
      expectedIssuer: id.pubKey,
      lastSeenSeq:    claim.body.s,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/replay/);
  });

  it('rejects replay (s < lastSeenSeq)', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, {
      expectedIssuer: id.pubKey,
      lastSeenSeq:    claim.body.s + 1_000,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/replay/);
  });
});

describe('reachabilityClaim — limits', () => {
  it('rejects t <= 0', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 0 });
    const res   = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ttl out of range/);
  });

  it('rejects t > maxTtlMs', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 20 * 60_000 });
    const res   = verifyReachabilityClaim(claim, {
      expectedIssuer: id.pubKey,
      maxTtlMs:       10 * 60_000,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ttl out of range/);
  });

  it('rejects oversize peers list', async () => {
    const id = await freshIdentity();
    const peers = [];
    for (let i = 0; i < 10; i++) peers.push(`pk${String(i).padStart(3, '0')}`);
    const claim = await signReachabilityClaim(id, peers, { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, {
      expectedIssuer: id.pubKey,
      maxPeers:       5,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/peers list too large/);
  });

  it('rejects oversize serialised payload', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA', 'pkB', 'pkC'], { ttlMs: 1000 });
    const res   = verifyReachabilityClaim(claim, {
      expectedIssuer: id.pubKey,
      maxBytes:       10,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/payload too large/);
  });
});

describe('reachabilityClaim — structure checks', () => {
  it('rejects unknown version', async () => {
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    claim.body.v = 2;
    const res = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unsupported version/);
  });

  it('rejects unsorted peers in the signed body', async () => {
    // Sign with a sorted list, then mutate to violate the sort order; should
    // still be rejected by the determinism guard before signature check.
    const id    = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA', 'pkB'], { ttlMs: 1000 });
    claim.body.p = ['pkB', 'pkA'];
    const res = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not strictly sorted/);
  });

  it('rejects a malformed claim shape (missing body)', async () => {
    const id  = await freshIdentity();
    const res = verifyReachabilityClaim({ sig: 'x' }, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/malformed claim shape/);
  });

  it('rejects a body missing required fields', async () => {
    const id = await freshIdentity();
    const claim = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    delete claim.body.s;
    const res = verifyReachabilityClaim(claim, { expectedIssuer: id.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing required fields/);
  });
});

describe('reachabilityClaim — monotonic sequence (seqStore)', () => {
  it('produces strictly increasing s on consecutive signs even with a frozen clock', async () => {
    const id       = await freshIdentity();
    const seqStore = createMemorySeqStore(0);

    const realNow = Date.now;
    const frozen  = 1_000_000;
    Date.now = () => frozen;
    try {
      const c1 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore });
      const c2 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore });
      const c3 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore });
      expect(c2.body.s).toBe(c1.body.s + 1);
      expect(c3.body.s).toBe(c2.body.s + 1);
    } finally {
      Date.now = realNow;
    }
  });

  it('never reverts s when the wall clock jumps backwards', async () => {
    const id       = await freshIdentity();
    const seqStore = createMemorySeqStore(0);
    const realNow  = Date.now;

    try {
      // First sign at a "normal" time.
      Date.now = () => 2_000_000;
      const c1 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore });
      expect(c1.body.s).toBe(2_000_000);

      // Now the clock jumps backwards by 1 million.
      Date.now = () => 1_000_000;
      const c2 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000, seqStore });
      expect(c2.body.s).toBe(c1.body.s + 1);  // NOT 1_000_000 — seq didn't revert
    } finally {
      Date.now = realNow;
    }
  });

  it('uses the default per-pubkey store when none is supplied', async () => {
    const id = await freshIdentity();
    const c1 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    const c2 = await signReachabilityClaim(id, ['pkA'], { ttlMs: 1000 });
    expect(c2.body.s).toBeGreaterThan(c1.body.s);
  });
});
