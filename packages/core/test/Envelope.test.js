import { describe, it, expect } from 'vitest';
import { P, REPLY_CODES, mkEnvelope, canonicalize, isEnvelope } from '../src/Envelope.js';

describe('P (pattern codes)', () => {
  it('has all 13 expected codes', () => {
    const expected = ['HI','OW','AS','AK','RQ','RS','PB','ST','SE','BT','IR','RI','CX'];
    for (const code of expected) {
      expect(P[code]).toBe(code);
    }
  });
});

describe('REPLY_CODES', () => {
  it('contains AK and RS', () => {
    expect(REPLY_CODES.has(P.AK)).toBe(true);
    expect(REPLY_CODES.has(P.RS)).toBe(true);
  });

  it('does not contain OW or RQ', () => {
    expect(REPLY_CODES.has(P.OW)).toBe(false);
    expect(REPLY_CODES.has(P.RQ)).toBe(false);
  });
});

describe('mkEnvelope', () => {
  it('creates an envelope with required fields', () => {
    const env = mkEnvelope(P.OW, 'alice', 'bob', { msg: 'hi' });
    expect(env._v).toBe(1);
    expect(env._p).toBe(P.OW);
    expect(env._from).toBe('alice');
    expect(env._to).toBe('bob');
    expect(env.payload).toEqual({ msg: 'hi' });
    expect(typeof env._id).toBe('string');
    expect(env._id.length).toBeGreaterThan(0);
    expect(typeof env._ts).toBe('number');
    expect(env._sig).toBeNull();
  });

  it('sets _re and _topic from opts', () => {
    const env = mkEnvelope(P.RS, 'a', 'b', {}, { re: 'orig-id', topic: 'updates' });
    expect(env._re).toBe('orig-id');
    expect(env._topic).toBe('updates');
  });

  it('defaults _re and _topic to null', () => {
    const env = mkEnvelope(P.OW, 'a', 'b', {});
    expect(env._re).toBeNull();
    expect(env._topic).toBeNull();
  });

  it('generates unique _ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => mkEnvelope(P.OW, 'a', 'b', {})._id));
    expect(ids.size).toBe(100);
  });

  it('_ts is close to Date.now()', () => {
    const before = Date.now();
    const env = mkEnvelope(P.OW, 'a', 'b', {});
    const after = Date.now();
    expect(env._ts).toBeGreaterThanOrEqual(before);
    expect(env._ts).toBeLessThanOrEqual(after);
  });
});

describe('canonicalize', () => {
  it('produces stable JSON regardless of property insertion order', () => {
    const env1 = { _v: 1, _p: 'OW', _id: 'x', _re: null, _from: 'a', _to: 'b',
                   _topic: null, _ts: 100, _sig: null, payload: {} };
    const env2 = { payload: {}, _ts: 100, _sig: null, _to: 'b', _from: 'a',
                   _re: null, _topic: null, _id: 'x', _p: 'OW', _v: 1 };
    expect(canonicalize(env1)).toBe(canonicalize(env2));
  });

  it('excludes _sig from canonical form', () => {
    const env = mkEnvelope(P.OW, 'a', 'b', {});
    const withSig    = { ...env, _sig: 'some-sig' };
    const withoutSig = { ...env, _sig: null };
    expect(canonicalize(withSig)).toBe(canonicalize(withoutSig));
  });

  it('returns a string', () => {
    expect(typeof canonicalize(mkEnvelope(P.OW, 'a', 'b', {}))).toBe('string');
  });
});

describe('isEnvelope', () => {
  it('returns true for a valid envelope', () => {
    expect(isEnvelope(mkEnvelope(P.OW, 'a', 'b', {}))).toBe(true);
  });

  it('returns false for null, non-objects, and incomplete objects', () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope('string')).toBe(false);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope({ _v: 1, _p: 'OW' })).toBe(false);
  });
});
