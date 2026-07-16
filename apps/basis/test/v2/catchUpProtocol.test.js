/**
 * ε.4 — catchUpProtocol substrate tests.  Pure helpers; no I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  CATCH_UP_SUBTYPES,
  CATCH_UP_MODES,
  DEFAULT_CHUNK_SIZE,
  makeRequestId,
  isValidRequest,
  isValidOffer,
  isValidAccept,
  isValidChunk,
  isValidEnd,
  jsonByteLength,
  computeOfferFromItems,
  applyModeFilter,
  chunkItems,
  buildRequest,
  buildOffer,
  buildAccept,
  buildChunk,
  buildEnd,
} from '../../src/v2/catchUpProtocol.js';

const baseRequest = {
  subtype: 'catch-up-request',
  msgId: 'r1', ts: 1,
  groupId: 'g1', sinceTs: 0, requestId: 'cu-1', fromPeerAddr: 'nkn-A',
};
const baseOffer = {
  subtype: 'catch-up-offer',
  msgId: 'r1', ts: 1,
  requestId: 'cu-1', count: 3, sizeBytes: 120, lastTs: 10,
};
const baseAccept = {
  subtype: 'catch-up-accept',
  msgId: 'r1', ts: 1,
  requestId: 'cu-1', mode: 'all',
};
const baseChunk = {
  subtype: 'catch-up-chunk',
  msgId: 'r1', ts: 1,
  requestId: 'cu-1', seq: 0, items: [], finished: true,
};
const baseEnd = {
  subtype: 'catch-up-end',
  msgId: 'r1', ts: 1,
  requestId: 'cu-1', totalSent: 3,
};

describe('CATCH_UP_SUBTYPES + CATCH_UP_MODES + DEFAULT_CHUNK_SIZE', () => {
  it('exports the five subtype constants', () => {
    expect(CATCH_UP_SUBTYPES).toEqual({
      REQUEST: 'catch-up-request',
      OFFER:   'catch-up-offer',
      ACCEPT:  'catch-up-accept',
      CHUNK:   'catch-up-chunk',
      END:     'catch-up-end',
    });
  });
  it('exports the three modes', () => {
    expect(CATCH_UP_MODES).toEqual(['all', 'last-50', 'last-7-days']);
  });
  it('default chunk size is 50', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(50);
  });
});

describe('makeRequestId', () => {
  it('returns distinct strings', () => {
    const ids = new Set();
    for (let i = 0; i < 20; i += 1) ids.add(makeRequestId());
    expect(ids.size).toBe(20);
  });
  it('returns a string prefixed with cu-', () => {
    expect(makeRequestId()).toMatch(/^cu-/);
  });
});

describe('isValidRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isValidRequest(baseRequest)).toBeTruthy();
  });
  it('rejects malformed', () => {
    expect(isValidRequest(null)).toBeFalsy();
    expect(isValidRequest({})).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, subtype: 'nope' })).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, groupId: '' })).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, requestId: '' })).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, fromPeerAddr: '' })).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, sinceTs: 'x' })).toBeFalsy();
    expect(isValidRequest({ ...baseRequest, sinceTs: NaN })).toBeFalsy();
  });
});

describe('isValidOffer', () => {
  it('accepts a well-formed offer', () => {
    expect(isValidOffer(baseOffer)).toBeTruthy();
  });
  it('accepts lastTs === null', () => {
    expect(isValidOffer({ ...baseOffer, lastTs: null })).toBeTruthy();
  });
  it('rejects malformed', () => {
    expect(isValidOffer(null)).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, subtype: 'nope' })).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, requestId: '' })).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, count: -1 })).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, count: 'x' })).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, sizeBytes: -1 })).toBeFalsy();
    expect(isValidOffer({ ...baseOffer, lastTs: 'x' })).toBeFalsy();
  });
});

describe('isValidAccept', () => {
  it('accepts well-formed accepts in each mode', () => {
    for (const mode of CATCH_UP_MODES) {
      expect(isValidAccept({ ...baseAccept, mode })).toBeTruthy();
    }
  });
  it('accepts optional maxBytes', () => {
    expect(isValidAccept({ ...baseAccept, maxBytes: 1024 })).toBeTruthy();
  });
  it('rejects malformed', () => {
    expect(isValidAccept(null)).toBeFalsy();
    expect(isValidAccept({ ...baseAccept, mode: 'unknown' })).toBeFalsy();
    expect(isValidAccept({ ...baseAccept, requestId: '' })).toBeFalsy();
    expect(isValidAccept({ ...baseAccept, maxBytes: 0 })).toBeFalsy();
    expect(isValidAccept({ ...baseAccept, maxBytes: -1 })).toBeFalsy();
    expect(isValidAccept({ ...baseAccept, maxBytes: 'x' })).toBeFalsy();
  });
});

describe('isValidChunk', () => {
  it('accepts a well-formed chunk', () => {
    expect(isValidChunk(baseChunk)).toBeTruthy();
    expect(isValidChunk({ ...baseChunk, items: [{}, {}], seq: 2, finished: false })).toBeTruthy();
  });
  it('rejects malformed', () => {
    expect(isValidChunk(null)).toBeFalsy();
    expect(isValidChunk({ ...baseChunk, seq: -1 })).toBeFalsy();
    expect(isValidChunk({ ...baseChunk, items: 'x' })).toBeFalsy();
    expect(isValidChunk({ ...baseChunk, finished: 'true' })).toBeFalsy();
    expect(isValidChunk({ ...baseChunk, requestId: '' })).toBeFalsy();
  });
});

describe('isValidEnd', () => {
  it('accepts a well-formed end', () => {
    expect(isValidEnd(baseEnd)).toBeTruthy();
  });
  it('rejects malformed', () => {
    expect(isValidEnd(null)).toBeFalsy();
    expect(isValidEnd({ ...baseEnd, totalSent: -1 })).toBeFalsy();
    expect(isValidEnd({ ...baseEnd, totalSent: 'x' })).toBeFalsy();
    expect(isValidEnd({ ...baseEnd, requestId: '' })).toBeFalsy();
  });
});

describe('jsonByteLength', () => {
  it('matches Buffer.byteLength of JSON.stringify shape', () => {
    const items = [{ ts: 1, text: 'hello' }, { ts: 2, text: 'world' }];
    const s = JSON.stringify(items);
    const expected = (typeof Buffer !== 'undefined')
      ? Buffer.byteLength(s, 'utf-8')
      : new TextEncoder().encode(s).length;
    expect(jsonByteLength(items)).toBe(expected);
  });
  it('returns 2 for empty array (the "[]" bytes)', () => {
    expect(jsonByteLength([])).toBe(2);
  });
  it('handles undefined / null as empty array (treats falsy as [])', () => {
    expect(jsonByteLength(undefined)).toBe(2);
    expect(jsonByteLength(null)).toBe(2);
  });
});

describe('computeOfferFromItems', () => {
  it('returns shape on a non-empty set', () => {
    const items = [{ ts: 5 }, { ts: 7 }, { ts: 3 }];
    const out = computeOfferFromItems(items, 0);
    expect(out.count).toBe(3);
    expect(out.sizeBytes).toBe(jsonByteLength(items));
    expect(out.lastTs).toBe(7);
  });
  it('returns count=0 + sizeBytes=0 + lastTs=null on empty', () => {
    expect(computeOfferFromItems([], 0)).toEqual({ count: 0, sizeBytes: 0, lastTs: null });
  });
  it('handles items without ts (falls back to sinceTs)', () => {
    const items = [{ text: 'no ts' }];
    const out = computeOfferFromItems(items, 100);
    expect(out.count).toBe(1);
    expect(out.lastTs).toBe(100);
  });
});

describe('applyModeFilter', () => {
  const mk = (n, baseTs = 0) =>
    Array.from({ length: n }, (_, i) => ({ ts: baseTs + i, text: `m${i}` }));

  it("'all' is a no-op (returns a copy)", () => {
    const items = mk(3);
    const out = applyModeFilter(items, 'all');
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it("'last-50' takes the tail when more than 50", () => {
    const items = mk(120);
    const out = applyModeFilter(items, 'last-50');
    expect(out).toHaveLength(50);
    expect(out[0].text).toBe('m70');
    expect(out[49].text).toBe('m119');
  });

  it("'last-50' returns all when count < 50", () => {
    const items = mk(20);
    const out = applyModeFilter(items, 'last-50');
    expect(out).toHaveLength(20);
  });

  it("'last-7-days' filters by ts >= now - 7d", () => {
    const now = 1_000_000_000_000;
    const dayMs = 24 * 3600 * 1000;
    const items = [
      { ts: now - 30 * dayMs, text: 'old' },
      { ts: now - 3 * dayMs,  text: 'recent' },
      { ts: now,              text: 'now' },
    ];
    const out = applyModeFilter(items, 'last-7-days', { now });
    expect(out.map((i) => i.text)).toEqual(['recent', 'now']);
  });

  it('unknown mode falls back to all (forward-compat)', () => {
    const items = mk(3);
    expect(applyModeFilter(items, 'whatever-future-mode')).toEqual(items);
  });

  it('empty input → empty output', () => {
    expect(applyModeFilter([], 'all')).toEqual([]);
    expect(applyModeFilter([], 'last-50')).toEqual([]);
    expect(applyModeFilter([], 'last-7-days', { now: 1 })).toEqual([]);
  });
});

describe('chunkItems', () => {
  it('splits even multiples', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ i }));
    const out = chunkItems(items, 25);
    expect(out).toHaveLength(4);
    expect(out.every((c) => c.length === 25)).toBe(true);
  });
  it('handles uneven', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ i }));
    const out = chunkItems(items, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(3);
    expect(out[1]).toHaveLength(3);
    expect(out[2]).toHaveLength(1);
  });
  it('returns [] for empty input', () => {
    expect(chunkItems([])).toEqual([]);
  });
  it('uses default chunkSize 50 when unspecified', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ i }));
    const out = chunkItems(items);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(50);
    expect(out[2]).toHaveLength(20);
  });
});

describe('buildRequest / buildOffer / buildAccept / buildChunk / buildEnd', () => {
  it('buildRequest produces a valid envelope', () => {
    const env = buildRequest({ groupId: 'g', sinceTs: 0, requestId: 'cu-x', fromPeerAddr: 'a', ts: 5 });
    expect(isValidRequest(env)).toBeTruthy();
    expect(env.msgId).toBe('cu-x');
    expect(env.ts).toBe(5);
  });
  it('buildOffer produces a valid envelope', () => {
    const env = buildOffer({ requestId: 'cu-x', count: 2, sizeBytes: 50, lastTs: 9 });
    expect(isValidOffer(env)).toBeTruthy();
    expect(env.msgId).toBe('cu-x-offer');
  });
  it('buildAccept produces a valid envelope (and omits maxBytes when absent)', () => {
    const env = buildAccept({ requestId: 'cu-x', mode: 'all' });
    expect(isValidAccept(env)).toBeTruthy();
    expect(env.maxBytes).toBeUndefined();

    const env2 = buildAccept({ requestId: 'cu-x', mode: 'last-50', maxBytes: 4096 });
    expect(isValidAccept(env2)).toBe(true);
    expect(env2.maxBytes).toBe(4096);
  });
  it('buildChunk produces a valid envelope', () => {
    const env = buildChunk({ requestId: 'cu-x', seq: 0, items: [{ a: 1 }], finished: true });
    expect(isValidChunk(env)).toBeTruthy();
  });
  it('buildEnd produces a valid envelope', () => {
    const env = buildEnd({ requestId: 'cu-x', totalSent: 7 });
    expect(isValidEnd(env)).toBeTruthy();
  });
});
