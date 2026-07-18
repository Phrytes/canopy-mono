import { describe, it, expect } from 'vitest';
import {
  OFFERING_AXES, DEFAULT_OFFERING, normalizeOffering, mergeOffering,
  offeringsMatchingEnabled, MATCH_SOURCES, buildOfferingMatches,
} from '../src/circleOfferings.js';

describe('circleOfferings · normalizeOffering', () => {
  it('fills defaults for an empty/garbage input', () => {
    expect(normalizeOffering()).toEqual(DEFAULT_OFFERING);
    expect(normalizeOffering(null)).toEqual(DEFAULT_OFFERING);
    expect(normalizeOffering('nope')).toEqual(DEFAULT_OFFERING);
  });

  it('keeps valid enum values and rejects invalid ones', () => {
    const s = normalizeOffering({ openness: 'public', posture: 'negotiable', status: 'paused', radius: 'city' });
    expect(s.openness).toBe('public');
    expect(s.posture).toBe('negotiable');
    expect(s.status).toBe('paused');
    expect(s.radius).toBe('city');

    const bad = normalizeOffering({ openness: 'bogus', posture: 'maybe', status: 'gone', radius: 'planet' });
    expect(bad.openness).toBe('private');
    expect(bad.posture).toBe('always');
    expect(bad.status).toBe('active');
    expect(bad.radius).toBe('home');
  });

  it('keeps a string name and defaults a non-string one', () => {
    expect(normalizeOffering({ name: 'lawn mowing' }).name).toBe('lawn mowing');
    expect(normalizeOffering({ name: 42 }).name).toBe('');
  });

  it('every axis default is the first listed enum value', () => {
    for (const axis of Object.keys(OFFERING_AXES)) {
      expect(DEFAULT_OFFERING[axis]).toBe(OFFERING_AXES[axis][0]);
    }
  });
});

describe('circleOfferings · mergeOffering', () => {
  it('applies a patch over a base without dropping other axes', () => {
    const base = normalizeOffering({ name: 'baking', openness: 'circle' });
    const next = mergeOffering(base, { status: 'paused' });
    expect(next.name).toBe('baking');     // preserved
    expect(next.openness).toBe('circle'); // preserved
    expect(next.status).toBe('paused');   // changed
  });

  it('normalises an invalid patch value back to default', () => {
    const next = mergeOffering(DEFAULT_OFFERING, { radius: 'galaxy' });
    expect(next.radius).toBe('home');
  });
});

describe('circleOfferings · offeringsMatchingEnabled (fold-in C/Q3 charter signal)', () => {
  it('is OFF for the default / unconfigured record (openness private)', () => {
    expect(offeringsMatchingEnabled()).toBe(false);
    expect(offeringsMatchingEnabled(null)).toBe(false);
    expect(offeringsMatchingEnabled(DEFAULT_OFFERING)).toBe(false);
    expect(offeringsMatchingEnabled({ openness: 'bogus' })).toBe(false);   // normalises → private
  });

  it('is ON when shared beyond private AND still active; paused/archived reads OFF', () => {
    expect(offeringsMatchingEnabled({ openness: 'circle' })).toBe(true);
    expect(offeringsMatchingEnabled({ openness: 'contacts' })).toBe(true);
    expect(offeringsMatchingEnabled({ openness: 'public' })).toBe(true);
    expect(offeringsMatchingEnabled({ openness: 'circle', status: 'paused' })).toBe(false);
    expect(offeringsMatchingEnabled({ openness: 'circle', status: 'archived' })).toBe(false);
  });
});

describe('circleOfferings · buildOfferingMatches', () => {
  it('returns [] for empty / missing input', () => {
    expect(buildOfferingMatches()).toEqual([]);
    expect(buildOfferingMatches({})).toEqual([]);
    expect(buildOfferingMatches({ matches: [] })).toEqual([]);
    expect(buildOfferingMatches({ matches: 'nope' })).toEqual([]);
  });

  it('tags each match source, defaulting unknown / missing to human', () => {
    const rows = buildOfferingMatches({
      matches: [
        { id: 'a', label: 'Bert', source: 'human' },
        { id: 'b', label: 'Tuinbot', source: 'agent' },
        { id: 'c', label: 'Sjoerd', source: 'via-hop' },
        { id: 'd', label: 'Unknown', source: 'mystery' },
        { id: 'e', label: 'NoSource' },
      ],
    });
    expect(MATCH_SOURCES).toEqual(['human', 'agent', 'via-hop']);
    expect(rows.map((r) => r.source)).toEqual(['human', 'agent', 'via-hop', 'human', 'human']);
    expect(rows[0]).toEqual({ id: 'a', label: 'Bert', source: 'human' });
  });

  it('synthesises an id when missing and defaults a missing label', () => {
    const rows = buildOfferingMatches({ matches: [{ source: 'agent' }, null, 5] });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('match-0');
    expect(rows[0].label).toBe('');
    expect(rows[0].source).toBe('agent');
  });
});
