// Property layer Phase 0 — the disclosure mechanism + the typed vocabulary.
import { describe, it, expect } from 'vitest';
import { own, inherit } from '../src/profileProperties.js';
import { descriptor, createVocabulary, isPropertyType, PROPERTY_TYPES } from '../src/propertyVocabulary.js';
import { createDisclosurePolicy, setDisclosure, getDisclosure, releasedValues } from '../src/disclosure.js';

// a tiny profile registry: id → { properties }
const reg = (profiles) => (id) => profiles[id] ?? null;

describe('propertyVocabulary', () => {
  it('validates descriptors + exposes type/ladder/coarsen', () => {
    const place = descriptor({
      key: 'place', type: 'coarse-enum', ladder: ['municipality', 'district', 'address'],
      coarsen: (v, rung) => (rung === 'municipality' && v && v.municipality ? v.municipality : v),
    });
    const vocab = createVocabulary([place, { key: 'goal', type: 'driver' }]);
    expect(vocab.type('place')).toBe('coarse-enum');
    expect(vocab.ladder('place')).toEqual(['municipality', 'district', 'address']);
    expect(vocab.type('goal')).toBe('driver');
    expect(vocab.has('nope')).toBe(false);
    expect(PROPERTY_TYPES).toContain('coded');
    expect(isPropertyType('made-up')).toBe(false);
  });

  it('coarsen reduces a value to a rung; missing coarsen fn → value unchanged; never throws', () => {
    const vocab = createVocabulary([
      descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality', 'address'],
        coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : `${v.address}, ${v.municipality}`) }),
      descriptor({ key: 'role', type: 'coarse-enum' }),   // no coarsen
    ]);
    expect(vocab.coarsen('place', { municipality: 'Groningen', address: 'Kerkstraat 12' }, 'municipality')).toBe('Groningen');
    expect(vocab.coarsen('role', 'resident', 'x')).toBe('resident');     // no coarsen fn → as-is
    // a value shape the coarsen fn can't reduce → undefined (fail-closed: withhold, never leak the fine value)
    expect(vocab.coarsen('place', 'a-plain-string', 'municipality')).toBeUndefined();
  });

  it('releasedValues WITHHOLDS a value its coarsen fn cannot reduce (fail-closed)', () => {
    const getProfile = reg({ default: { properties: { place: own('a-plain-string') } } });
    const vocab = createVocabulary([descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality'],
      coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : v) })]);   // expects {municipality}; string → undefined
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { enabled: true, rung: 'municipality' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, { items: [{ key: 'place' }] }, policy, 'c', vocab))
      .toEqual({});   // withheld, not leaked raw
  });

  it('rejects an unknown type / a bad ladder', () => {
    expect(() => descriptor({ key: 'x', type: 'weird' })).toThrow(/unknown type/);
    expect(() => descriptor({ key: 'x', ladder: [1, 2] })).toThrow(/ladder/);
    expect(() => descriptor({ type: 'scalar' })).toThrow(/key required/);
  });
});

describe('disclosure policy — default-withhold', () => {
  it('a fresh policy shares nothing (default withhold, absent not marked)', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen'), role: own('resident') } } });
    const req = { items: [{ key: 'place' }, { key: 'role' }] };
    const policy = createDisclosurePolicy();
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'buurt-42')).toEqual({});
    expect(getDisclosure(policy, 'buurt-42', 'place')).toEqual({ enabled: false, rung: null });
  });

  it('releases only enabled keys the request asks for; withheld absent', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen'), role: own('resident') } } });
    const req = { items: [{ key: 'place' }, { key: 'role' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'buurt-42', 'place', { enabled: true });   // share place, withhold role
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'buurt-42'))
      .toEqual({ place: 'Groningen' });
  });

  it('is per-context: enabling for one circle does not leak to another', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen') } } });
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circleA', 'place', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circleA')).toEqual({ place: 'Groningen' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circleB')).toEqual({});
  });

  it('resolves an INHERITED value (a persona inherits place from the default profile)', () => {
    const getProfile = reg({
      default: { properties: { place: own('Groningen') } },
      work:    { properties: { place: inherit() } },        // work persona inherits place
    });
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'werk-7', 'place', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'work', defaultProfileId: 'default' }, req, policy, 'werk-7'))
      .toEqual({ place: 'Groningen' });
  });

  it('coarsens the released value to the chosen rung via the vocabulary', () => {
    const getProfile = reg({ default: { properties: { place: own({ municipality: 'Groningen', address: 'Kerkstraat 12' }) } } });
    const vocab = createVocabulary([descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality', 'address'],
      coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : v) })]);
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { enabled: true, rung: 'municipality' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'c', vocab))
      .toEqual({ place: 'Groningen' });   // fine address coarsened away
  });

  it('passes an opaque coded value through unchanged (medical hook — value is not a string)', () => {
    // §6: a property value may be a structured { code, system } — the layer never assumes a string.
    const coded = { code: '294505008', system: 'SNOMED', severity: 'severe' };
    const getProfile = reg({ default: { properties: { allergy: own(coded) } } });
    const req = { items: [{ key: 'allergy' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'clinic', 'allergy', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'clinic'))
      .toEqual({ allergy: coded });
  });

  it('setDisclosure is immutable (returns a new policy)', () => {
    const p0 = createDisclosurePolicy();
    const p1 = setDisclosure(p0, 'c', 'place', { enabled: true });
    expect(p0.perContext).toEqual({});
    expect(getDisclosure(p1, 'c', 'place').enabled).toBe(true);
  });
});
