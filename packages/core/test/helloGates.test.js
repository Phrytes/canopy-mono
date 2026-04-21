/**
 * helloGates — ready-made gate predicates (Group W).
 */
import { describe, it, expect, vi } from 'vitest';
import { tokenGate, groupGate, anyOf } from '../src/security/helloGates.js';

const env = (payload = {}) => ({ _from: 'alice', payload });

describe('tokenGate', () => {
  it('accepts when authToken matches', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({ authToken: 'sesame' }))).toBe(true);
  });

  it('rejects on wrong token', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({ authToken: 'wrong' }))).toBe(false);
  });

  it('rejects when authToken is missing', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({}))).toBe(false);
    expect(await gate(env())).toBe(false);
    expect(await gate({ _from: 'alice' })).toBe(false);
  });

  it('throws when constructed with an empty secret', () => {
    expect(() => tokenGate('')).toThrow();
    expect(() => tokenGate(null)).toThrow();
  });
});

describe('groupGate', () => {
  it('accepts a valid proof for one of the groupIds', async () => {
    const gm = {
      verifyProof: vi.fn(async (_proof, gid) => gid === 'team-a'),
    };
    const gate = groupGate(['team-a', 'team-b'], gm);
    const ok = await gate(env({ authToken: { gid: 'team-a', sig: 'x' } }));
    expect(ok).toBe(true);
  });

  it('rejects when no group matches', async () => {
    const gm = { verifyProof: vi.fn(async () => false) };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({ authToken: { sig: 'x' } }))).toBe(false);
  });

  it('rejects when authToken is absent', async () => {
    const gm = { verifyProof: vi.fn(async () => true) };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({}))).toBe(false);
    expect(gm.verifyProof).not.toHaveBeenCalled();
  });

  it('fail-closed when verifyProof throws', async () => {
    const gm = { verifyProof: async () => { throw new Error('kaboom'); } };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({ authToken: {} }))).toBe(false);
  });

  it('throws on bad construction args', () => {
    expect(() => groupGate([],   { verifyProof: () => {} })).toThrow();
    expect(() => groupGate(['a'], null)).toThrow();
  });
});

describe('anyOf', () => {
  const yes = async () => true;
  const no  = async () => false;
  const bad = async () => { throw new Error('x'); };

  it('passes if any sub-gate passes', async () => {
    const gate = anyOf(no, yes, no);
    expect(await gate(env())).toBe(true);
  });

  it('rejects if all sub-gates reject', async () => {
    const gate = anyOf(no, no, no);
    expect(await gate(env())).toBe(false);
  });

  it('tolerates a throwing sub-gate and keeps checking the rest', async () => {
    const gate = anyOf(bad, yes);
    expect(await gate(env())).toBe(true);
  });

  it('short-circuits on the first accept', async () => {
    const spy = vi.fn(async () => true);
    const gate = anyOf(yes, spy);
    await gate(env());
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts zero arguments as always-reject', async () => {
    const gate = anyOf();
    expect(await gate(env())).toBe(false);
  });
});
