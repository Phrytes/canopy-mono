// Personal drivers (#3) — the `driver` property type: shape, validation, tag normalisation, and the
// vocabulary descriptor. Open { kind, text, tags[] }, not coarse buckets; all-or-nothing disclosure.
import { describe, it, expect } from 'vitest';
import {
  DRIVER_KINDS, isDriverKind, normalizeDriverKind, normalizeTag, normalizeTags,
  createDriver, isDriverValue, driverDescriptor, createVocabulary,
} from '../index.js';

describe('drivers (#3) — the driver property type', () => {
  it('kinds: the finer intents + the generic catch-all + offering + interest (fold-ins)', () => {
    expect(DRIVER_KINDS).toEqual(['hobby', 'goal', 'desire', 'motivation', 'driver', 'offering', 'interest']);
    expect(isDriverKind('goal')).toBe(true);
    expect(isDriverKind('offering')).toBe(true);
    expect(isDriverKind('interest')).toBe(true);   // interests→drivers fold-in (audit §4/Q6)
    expect(isDriverKind('skill')).toBe(true);   // legacy alias read-accepted
    expect(isDriverKind('nonsense')).toBe(false);
    expect(isDriverKind(null)).toBe(false);
  });

  it('createDriver: kind interest is a FREE driver (tags carry it, no taxonomy/coarse rung)', () => {
    const s = createDriver({ kind: 'interest', text: '', tags: ['Zeilen', 'houtbewerking'] });
    expect(s.kind).toBe('interest');
    expect(s.text).toBe('');
    expect(s.tags).toEqual(['zeilen', 'houtbewerking']);
    expect(s.categoryId).toBeUndefined();   // interests have no coarse taxonomy rung
    expect(isDriverValue(s)).toBe(true);
  });

  it('createDriver: kind offering is accepted, NOT downgraded to the generic driver', () => {
    const s = createDriver({ kind: 'offering', text: 'bike repair', tags: ['Fietsen', 'repareren'] });
    expect(s.kind).toBe('offering');
    expect(isDriverValue(s)).toBe(true);
  });

  it('createDriver: legacy kind skill normalizes to offering (back-compat)', () => {
    expect(normalizeDriverKind('skill')).toBe('offering');
    const s = createDriver({ kind: 'skill', text: 'bike repair', tags: ['Fietsen'] });
    expect(s.kind).toBe('offering');
    expect(isDriverValue(s)).toBe(true);
  });

  it('normalizeTag: lowercases, hyphenates, strips junk', () => {
    expect(normalizeTag('  Learning To Sail ')).toBe('learning-to-sail');
    expect(normalizeTag('Co_Founder')).toBe('co-founder');
    expect(normalizeTag('C++ & Rust!')).toBe('c-rust');
    expect(normalizeTag('---edge---')).toBe('edge');
    expect(normalizeTag('   ')).toBe('');
  });

  it('normalizeTags: normalises, drops empties, de-dupes (first-seen order)', () => {
    expect(normalizeTags(['Sailing', 'sailing', ' ', 'Learning', 'learning'])).toEqual(['sailing', 'learning']);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('createDriver: validated, frozen { kind, text, tags[] }', () => {
    const d = createDriver({ kind: 'goal', text: '  Find people to learn sailing with ', tags: ['Sailing', 'sailing', 'Learning'] });
    expect(d).toEqual({ kind: 'goal', text: 'Find people to learn sailing with', tags: ['sailing', 'learning'] });
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.tags)).toBe(true);
  });

  it('createDriver: unknown kind falls back to the generic driver; text-only or tags-only both OK', () => {
    expect(createDriver({ kind: 'zzz', text: 'x' }).kind).toBe('driver');
    expect(createDriver({ text: 'just a phrase' }).tags).toEqual([]);
    expect(createDriver({ tags: ['just-tags'] }).text).toBe('');
  });

  it('createDriver: a driver with neither text nor tags is meaningless → throws', () => {
    expect(() => createDriver({ kind: 'goal' })).toThrow(/text or one tag/);
    expect(() => createDriver({ text: '   ', tags: ['  '] })).toThrow();
  });

  it('isDriverValue: shape guard for opaque stored values', () => {
    expect(isDriverValue(createDriver({ text: 'x', tags: ['y'] }))).toBe(true);
    expect(isDriverValue({ kind: 'goal', text: 'x', tags: [] })).toBe(true);
    expect(isDriverValue({ kind: 'goal', text: '', tags: [] })).toBe(false);   // empty → not meaningful
    expect(isDriverValue({ kind: 'bad', text: 'x', tags: [] })).toBe(false);   // bad kind
    expect(isDriverValue('a coarse-enum string')).toBe(false);
    expect(isDriverValue(null)).toBe(false);
  });

  it('driverDescriptor: type driver, sensitive, no coarseness ladder (all-or-nothing)', () => {
    const d = driverDescriptor('goals');
    expect(d.key).toBe('goals');
    expect(d.type).toBe('driver');
    expect(d.sensitivity).toBe('sensitive');
    expect(d.ladder).toBe(null);
    // registers cleanly into a property vocabulary
    const vocab = createVocabulary([d]);
    expect(vocab.type('goals')).toBe('driver');
    expect(vocab.ladder('goals')).toBe(null);
    // no coarsen fn → coarsening a driver returns it unchanged (never partially leaks)
    const v = createDriver({ text: 'x', tags: ['y'] });
    expect(vocab.coarsen('goals', v, 'anything')).toBe(v);
  });
});
