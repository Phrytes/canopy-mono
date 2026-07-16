// @onderling/core — MergeContracts unit tests
import { describe, it, expect } from 'vitest';
import {
  setUnionWithDedupe,
  appendOnlyEventLog,
  lastWriteWins,
  MergeContracts,
} from '../../src/storage/MergeContracts/index.js';

// ─── helpers ───────────────────────────────────────────────────────────────
function v (value, timestamp, sourceId) {
  return { value, timestamp, sourceId };
}

// Deterministic but irregular pseudo-random for property-style tests.
function lcg (seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//   setUnionWithDedupe
// ═══════════════════════════════════════════════════════════════════════════

describe('setUnionWithDedupe', () => {
  it('returns [] on empty input', () => {
    expect(setUnionWithDedupe([])).toEqual([]);
  });

  it('returns [] on null/undefined input', () => {
    expect(setUnionWithDedupe(null)).toEqual([]);
    expect(setUnionWithDedupe(undefined)).toEqual([]);
  });

  it('passes through a single version (deduped)', () => {
    const out = setUnionWithDedupe([v([{ id: 1 }, { id: 1 }, { id: 2 }], 100, 'pod-a')], {
      itemHash: (x) => String(x.id),
    });
    expect(out).toHaveLength(2);
    const ids = out.map((x) => x.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('produces union of items from multiple versions', () => {
    const out = setUnionWithDedupe(
      [
        v([{ id: 1 }, { id: 2 }], 100, 'pod-a'),
        v([{ id: 2 }, { id: 3 }], 200, 'pod-b'),
      ],
      { itemHash: (x) => String(x.id) }
    );
    expect(out.map((x) => x.id).sort()).toEqual([1, 2, 3]);
  });

  it('keeps the highest-timestamp instance on duplicates', () => {
    const out = setUnionWithDedupe(
      [
        v([{ id: 1, label: 'old' }], 100, 'pod-a'),
        v([{ id: 1, label: 'new' }], 200, 'pod-b'),
      ],
      { itemHash: (x) => String(x.id) }
    );
    expect(out).toEqual([{ id: 1, label: 'new' }]);
  });

  it('on timestamp tie, larger sourceId wins', () => {
    const out = setUnionWithDedupe(
      [
        v([{ id: 1, from: 'a' }], 100, 'pod-a'),
        v([{ id: 1, from: 'b' }], 100, 'pod-b'),
      ],
      { itemHash: (x) => String(x.id) }
    );
    expect(out).toEqual([{ id: 1, from: 'b' }]);
  });

  it('uses default structural hash when itemHash not supplied', () => {
    const out = setUnionWithDedupe([
      v([{ id: 1 }, { id: 1 }], 100, 'pod-a'),
      v([{ id: 1 }, { id: 2 }], 200, 'pod-b'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('default hash is order-independent for object keys', () => {
    const out = setUnionWithDedupe([
      v([{ a: 1, b: 2 }], 100, 'pod-a'),
      v([{ b: 2, a: 1 }], 200, 'pod-b'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('output is deterministic across runs (sorted by hash)', () => {
    const versions = [
      v([{ id: 'gamma' }, { id: 'alpha' }], 100, 'pod-a'),
      v([{ id: 'beta' }], 200, 'pod-b'),
    ];
    const a = setUnionWithDedupe(versions, { itemHash: (x) => x.id });
    const b = setUnionWithDedupe(versions, { itemHash: (x) => x.id });
    expect(a).toEqual(b);
    expect(a.map((x) => x.id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles ~100 versions deterministically', () => {
    const rand = lcg(42);
    const versions = [];
    for (let i = 0; i < 100; i++) {
      const items = [];
      const n = 1 + Math.floor(rand() * 5);
      for (let j = 0; j < n; j++) {
        items.push({ id: Math.floor(rand() * 30) });
      }
      versions.push(v(items, Math.floor(rand() * 1000), 'pod-' + i));
    }
    const a = setUnionWithDedupe(versions, { itemHash: (x) => String(x.id) });
    const b = setUnionWithDedupe(versions, { itemHash: (x) => String(x.id) });
    expect(a).toEqual(b);
    // No duplicates by id
    const ids = a.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Sorted by hash (= String(id))
    const sorted = [...ids].sort((x, y) => (String(x) < String(y) ? -1 : 1));
    expect(ids).toEqual(sorted);
  });

  it('skips versions with non-array value gracefully', () => {
    const out = setUnionWithDedupe([
      v([{ id: 1 }], 100, 'pod-a'),
      v(null, 200, 'pod-b'),
      v('not-an-array', 300, 'pod-c'),
      v([{ id: 2 }], 400, 'pod-d'),
    ]);
    expect(out).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   appendOnlyEventLog
// ═══════════════════════════════════════════════════════════════════════════

describe('appendOnlyEventLog', () => {
  it('returns [] on empty input', () => {
    expect(appendOnlyEventLog([])).toEqual([]);
  });

  it('returns [] on null/undefined input', () => {
    expect(appendOnlyEventLog(null)).toEqual([]);
    expect(appendOnlyEventLog(undefined)).toEqual([]);
  });

  it('passes through a single version sorted by event timestamp', () => {
    const out = appendOnlyEventLog([
      v(
        [
          { timestamp: 300, type: 'c' },
          { timestamp: 100, type: 'a' },
          { timestamp: 200, type: 'b' },
        ],
        999,
        'pod-a'
      ),
    ]);
    expect(out.map((e) => e.type)).toEqual(['a', 'b', 'c']);
  });

  it('merges events from multiple versions ordered by event timestamp', () => {
    const out = appendOnlyEventLog([
      v(
        [
          { timestamp: 100, type: 'a' },
          { timestamp: 300, type: 'c' },
        ],
        999,
        'pod-a'
      ),
      v([{ timestamp: 200, type: 'b' }], 999, 'pod-b'),
    ]);
    expect(out.map((e) => e.type)).toEqual(['a', 'b', 'c']);
  });

  it('uses event timestamp, not outer version timestamp', () => {
    // Version timestamp is misleading on purpose.
    const out = appendOnlyEventLog([
      v([{ timestamp: 999, type: 'late' }], 1, 'pod-a'),
      v([{ timestamp: 1, type: 'early' }], 999, 'pod-b'),
    ]);
    expect(out.map((e) => e.type)).toEqual(['early', 'late']);
  });

  it('tie-breaks by sourceId ascending on equal event timestamps', () => {
    const out = appendOnlyEventLog([
      v([{ timestamp: 100, from: 'b' }], 999, 'pod-b'),
      v([{ timestamp: 100, from: 'a' }], 999, 'pod-a'),
      v([{ timestamp: 100, from: 'c' }], 999, 'pod-c'),
    ]);
    expect(out.map((e) => e.from)).toEqual(['a', 'b', 'c']);
  });

  it('preserves intra-source order on event-timestamp ties (stable)', () => {
    const out = appendOnlyEventLog([
      v(
        [
          { timestamp: 100, idx: 0 },
          { timestamp: 100, idx: 1 },
          { timestamp: 100, idx: 2 },
        ],
        999,
        'pod-a'
      ),
    ]);
    expect(out.map((e) => e.idx)).toEqual([0, 1, 2]);
  });

  it('handles identical events across versions (no dedupe — append-only)', () => {
    const out = appendOnlyEventLog([
      v([{ timestamp: 100, type: 'x' }], 999, 'pod-a'),
      v([{ timestamp: 100, type: 'x' }], 999, 'pod-b'),
    ]);
    // Both kept — append-only doesn't dedupe.
    expect(out).toHaveLength(2);
  });

  it('handles ~100 versions deterministically', () => {
    const rand = lcg(7);
    const versions = [];
    for (let i = 0; i < 100; i++) {
      const events = [];
      const n = 1 + Math.floor(rand() * 4);
      for (let j = 0; j < n; j++) {
        events.push({ timestamp: Math.floor(rand() * 10000), seq: i * 100 + j });
      }
      versions.push(v(events, 0, 'pod-' + String(i).padStart(3, '0')));
    }
    const a = appendOnlyEventLog(versions);
    const b = appendOnlyEventLog(versions);
    expect(a).toEqual(b);
    // Sorted ascending by event timestamp
    for (let i = 1; i < a.length; i++) {
      expect(a[i].timestamp >= a[i - 1].timestamp).toBe(true);
    }
  });

  it('skips versions with non-array value gracefully', () => {
    const out = appendOnlyEventLog([
      v([{ timestamp: 100, type: 'a' }], 0, 'pod-a'),
      v(null, 0, 'pod-b'),
      v('nope', 0, 'pod-c'),
    ]);
    expect(out).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   lastWriteWins
// ═══════════════════════════════════════════════════════════════════════════

describe('lastWriteWins', () => {
  it('returns undefined on empty input', () => {
    expect(lastWriteWins([])).toBeUndefined();
  });

  it('returns undefined on null/undefined input', () => {
    expect(lastWriteWins(null)).toBeUndefined();
    expect(lastWriteWins(undefined)).toBeUndefined();
  });

  it('returns the value of a single version', () => {
    expect(lastWriteWins([v({ x: 1 }, 100, 'pod-a')])).toEqual({ x: 1 });
  });

  it('picks the highest-timestamp version', () => {
    const out = lastWriteWins([
      v({ name: 'old' }, 100, 'pod-a'),
      v({ name: 'new' }, 200, 'pod-b'),
      v({ name: 'mid' }, 150, 'pod-c'),
    ]);
    expect(out).toEqual({ name: 'new' });
  });

  it('on timestamp tie, larger sourceId wins', () => {
    const out = lastWriteWins([
      v({ from: 'a' }, 100, 'pod-a'),
      v({ from: 'b' }, 100, 'pod-b'),
      v({ from: 'c' }, 100, 'pod-c'),
    ]);
    expect(out).toEqual({ from: 'c' });
  });

  it('handles identical values across versions (still picks one deterministically)', () => {
    const out = lastWriteWins([
      v({ same: 'thing' }, 100, 'pod-a'),
      v({ same: 'thing' }, 100, 'pod-b'),
    ]);
    expect(out).toEqual({ same: 'thing' });
  });

  it('preserves primitive values (not just objects)', () => {
    expect(lastWriteWins([v(42, 100, 'a'), v(99, 200, 'b')])).toBe(99);
    expect(lastWriteWins([v('hello', 100, 'a'), v('world', 200, 'b')])).toBe('world');
  });

  it('preserves null/undefined value if the winner has it', () => {
    const out = lastWriteWins([
      v({ x: 1 }, 100, 'pod-a'),
      v(null, 200, 'pod-b'),
    ]);
    expect(out).toBe(null);
  });

  it('handles ~100 versions deterministically', () => {
    const rand = lcg(13);
    const versions = [];
    for (let i = 0; i < 100; i++) {
      versions.push(v({ i }, Math.floor(rand() * 1000), 'pod-' + String(i).padStart(3, '0')));
    }
    const a = lastWriteWins(versions);
    const b = lastWriteWins(versions);
    expect(a).toEqual(b);
    // Sanity: max-ts winner
    let maxTs = -Infinity;
    for (const ver of versions) if (ver.timestamp > maxTs) maxTs = ver.timestamp;
    const winners = versions.filter((vv) => vv.timestamp === maxTs);
    let bestSourceId = winners[0].sourceId;
    for (const w of winners) if (w.sourceId > bestSourceId) bestSourceId = w.sourceId;
    const expected = winners.find((w) => w.sourceId === bestSourceId).value;
    expect(a).toEqual(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   MergeContracts map
// ═══════════════════════════════════════════════════════════════════════════

describe('MergeContracts map', () => {
  it('exposes all three contracts under their names', () => {
    expect(MergeContracts.setUnionWithDedupe).toBe(setUnionWithDedupe);
    expect(MergeContracts.appendOnlyEventLog).toBe(appendOnlyEventLog);
    expect(MergeContracts.lastWriteWins).toBe(lastWriteWins);
  });

  it('all contracts share the (versions, opts) shape and are pure', () => {
    const versions = [v([{ id: 1, timestamp: 1 }], 100, 'pod-a')];
    // Run twice — same input, same output, no observable mutation.
    const before = JSON.stringify(versions);
    const a1 = MergeContracts.setUnionWithDedupe(versions);
    const a2 = MergeContracts.setUnionWithDedupe(versions);
    const b1 = MergeContracts.appendOnlyEventLog(versions);
    const b2 = MergeContracts.appendOnlyEventLog(versions);
    const c1 = MergeContracts.lastWriteWins(versions);
    const c2 = MergeContracts.lastWriteWins(versions);
    expect(a1).toEqual(a2);
    expect(b1).toEqual(b2);
    expect(c1).toEqual(c2);
    expect(JSON.stringify(versions)).toBe(before);
  });
});
