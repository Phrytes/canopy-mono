// availability — the unified person-level reachability property (decision).
// Pins: the states/ladder constants, availabilityState extraction (string + future
// object form), isAway, and the descriptor's FAIL-CLOSED coarsen (only 'detail'
// releases the whole value; 'state'/null/unknown collapse to the bare state).
import { describe, it, expect } from 'vitest';
import {
  AVAILABILITY_STATES, AVAILABILITY_AWAY, AVAILABILITY_LADDER,
  isAvailabilityState, availabilityState, isAway, availabilityDescriptor,
} from '../src/availability.js';

describe('availability constants', () => {
  it('exposes the coarse state enum + away + ladder', () => {
    expect(AVAILABILITY_STATES).toEqual(['open', 'limited', 'away']);
    expect(AVAILABILITY_AWAY).toBe('away');
    expect(AVAILABILITY_LADDER).toEqual(['state', 'detail']);   // coarsest → finest
  });
});

describe('isAvailabilityState / availabilityState / isAway', () => {
  it('validates the enum', () => {
    expect(isAvailabilityState('open')).toBe(true);
    expect(isAvailabilityState('busy')).toBe(false);
    expect(isAvailabilityState(null)).toBe(false);
  });
  it('extracts the state from a plain string', () => {
    expect(availabilityState('away')).toBe('away');
    expect(availabilityState('nope')).toBe(null);
  });
  it('extracts the state from a future { state, when } form', () => {
    expect(availabilityState({ state: 'limited', when: 'evenings' })).toBe('limited');
    expect(availabilityState({ when: 'evenings' })).toBe(null);
  });
  it('isAway is true only for away (string or object)', () => {
    expect(isAway('away')).toBe(true);
    expect(isAway({ state: 'away' })).toBe(true);
    expect(isAway('open')).toBe(false);
    expect(isAway(undefined)).toBe(false);
  });
});

describe('availabilityDescriptor', () => {
  const d = availabilityDescriptor();

  it('is a coarse-enum descriptor with the state→detail ladder', () => {
    expect(d.key).toBe('availability');
    expect(d.type).toBe('coarse-enum');
    expect(d.ladder).toEqual(['state', 'detail']);
    expect(d.sensitivity).toBe('normal');
  });

  it("'detail' (finest) releases the whole value", () => {
    expect(d.coarsen('limited', 'detail')).toBe('limited');
    const rich = { state: 'limited', when: 'weekends' };
    expect(d.coarsen(rich, 'detail')).toEqual(rich);   // incl. the free-text "when"
  });

  it("'state' (coarsest) drops any free-text when and yields just the state", () => {
    expect(d.coarsen('away', 'state')).toBe('away');
    expect(d.coarsen({ state: 'away', when: 'aug' }, 'state')).toBe('away');   // when dropped
  });

  it('FAILS CLOSED on a null/unknown rung — collapses to the bare state', () => {
    expect(d.coarsen({ state: 'away', when: 'aug' }, null)).toBe('away');
    expect(d.coarsen({ state: 'away', when: 'aug' }, 'bogus')).toBe('away');
    expect(d.coarsen('junk', 'state')).toBe(null);   // unrecognised value → nothing revealed
  });

  it('honours a custom key', () => {
    expect(availabilityDescriptor('reachability').key).toBe('reachability');
  });
});
