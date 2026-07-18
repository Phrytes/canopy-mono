// location — the folded-in coarse PLACE property with the design's canonical ladder
// (audit §4; NOTE-personal-properties-and-disclosure §2). Pins: the ladder/predicate
// constants, isLocationValue / locationLabel / inArea, and the descriptor's FAIL-CLOSED
// coarsen (raw coords leave ONLY at 'coords'; coarser rungs → a label; in-area/null → the
// y/n predicate).
import { describe, it, expect } from 'vitest';
import {
  LOCATION_LADDER, LOCATION_IN_AREA,
  isLocationValue, locationLabel, inArea, locationDescriptor,
} from '../src/location.js';

describe('location constants', () => {
  it('exposes the coarsest→finest ladder + the in-area predicate rung', () => {
    expect(LOCATION_LADDER).toEqual(['in-area', 'region', 'municipality', 'district', 'coords']);
    expect(LOCATION_IN_AREA).toBe('in-area');
  });
});

describe('isLocationValue', () => {
  it('accepts a non-empty label string', () => {
    expect(isLocationValue('Amsterdam')).toBe(true);
    expect(isLocationValue('')).toBe(false);
    expect(isLocationValue(null)).toBe(false);
  });
  it('accepts a location object (label / cell / named field / coords)', () => {
    expect(isLocationValue({ label: 'Amsterdam' })).toBe(true);
    expect(isLocationValue({ cell: '52.3,4.9' })).toBe(true);
    expect(isLocationValue({ municipality: 'Utrecht' })).toBe(true);
    expect(isLocationValue({ coords: { lat: 52.3, long: 4.9 } })).toBe(true);
    expect(isLocationValue({})).toBe(false);
  });
});

describe('locationLabel — the coarse place token, NEVER coords', () => {
  it('returns the string as-is', () => {
    expect(locationLabel('Amsterdam')).toBe('Amsterdam');
    expect(locationLabel('')).toBe(null);
  });
  it('prefers the coarsest named field, then label/cell', () => {
    expect(locationLabel({ district: 'Centrum', municipality: 'Amsterdam', region: 'NH' })).toBe('NH');
    expect(locationLabel({ district: 'Centrum', municipality: 'Amsterdam' })).toBe('Amsterdam');
    expect(locationLabel({ label: 'Amsterdam', cell: '52.3,4.9' })).toBe('Amsterdam');
    expect(locationLabel({ cell: '52.3,4.9' })).toBe('52.3,4.9');
  });
  it('is null when only raw coords are present (no human place name)', () => {
    expect(locationLabel({ coords: { lat: 52.3, long: 4.9 } })).toBe(null);
  });
});

describe('inArea predicate', () => {
  it('is true iff a location is present', () => {
    expect(inArea('Amsterdam')).toBe(true);
    expect(inArea({ municipality: 'Utrecht' })).toBe(true);
    expect(inArea(null)).toBe(false);
    expect(inArea('')).toBe(false);
  });
});

describe('locationDescriptor', () => {
  const d = locationDescriptor();

  it('is a coarse-enum descriptor with the in-area→coords ladder, sensitive', () => {
    expect(d.key).toBe('location');
    expect(d.type).toBe('coarse-enum');
    expect(d.ladder).toEqual(['in-area', 'region', 'municipality', 'district', 'coords']);
    expect(d.sensitivity).toBe('sensitive');
  });

  it("'coords' (finest) releases the whole value, incl. raw coordinates", () => {
    const rich = { label: 'Amsterdam', coords: { lat: 52.3, long: 4.9 } };
    expect(d.coarsen(rich, 'coords')).toEqual(rich);
    expect(d.coarsen('Amsterdam', 'coords')).toBe('Amsterdam');
  });

  it('a named coarse rung releases a coarse label, NEVER coords', () => {
    const rich = { district: 'Centrum', municipality: 'Amsterdam', region: 'NH', coords: { lat: 52.3, long: 4.9 } };
    // district rung prefers the district field; municipality/region fall coarser
    expect(d.coarsen(rich, 'district')).toBe('Centrum');
    expect(d.coarsen(rich, 'municipality')).toBe('Amsterdam');
    expect(d.coarsen(rich, 'region')).toBe('NH');
    // a bare coarse token stays the token at every named rung (geo-coarsening TODO)
    expect(d.coarsen('Amsterdam', 'municipality')).toBe('Amsterdam');
    // never leaks coords at a named rung
    expect(JSON.stringify(d.coarsen(rich, 'municipality'))).not.toContain('lat');
  });

  it("'in-area' (coarsest) yields the y/n predicate only", () => {
    expect(d.coarsen({ label: 'Amsterdam' }, 'in-area')).toBe(true);
    expect(d.coarsen('Amsterdam', 'in-area')).toBe(true);
  });

  it('FAILS CLOSED on a null/unknown rung — collapses to the in-area predicate', () => {
    const rich = { label: 'Amsterdam', coords: { lat: 52.3, long: 4.9 } };
    expect(d.coarsen(rich, null)).toBe(true);
    expect(d.coarsen(rich, 'bogus')).toBe(true);
    expect(d.coarsen(null, 'coords')).toBe(null);   // nothing stored → nothing revealed
  });

  it('honours a custom key', () => {
    expect(locationDescriptor('whereabouts').key).toBe('whereabouts');
  });
});
