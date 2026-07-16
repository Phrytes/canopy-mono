// Vocabulary: coarse by construction — enums are closed; place is open-coarse but guards fine values.
import { describe, it, expect } from 'vitest';
import { attributeKeys, isVocabKey, bucketsFor, isValidValue, bucketCount } from '../src/vocabulary.js';

describe('vocabulary', () => {
  it('offers exactly the five curated keys', () => {
    expect(attributeKeys().sort()).toEqual(['ageBand', 'household', 'place', 'role', 'tenure']);
    expect(isVocabKey('ageBand')).toBe(true);
    expect(isVocabKey('income')).toBe(false);
  });

  it('enum attributes only accept their buckets', () => {
    expect(bucketsFor('ageBand')).toContain('35-54');
    expect(isValidValue('ageBand', '35-54')).toBe(true);
    expect(isValidValue('ageBand', '37')).toBe(false);          // exact age rejected
    expect(isValidValue('role', 'mayor')).toBe(false);
  });

  it('place is open-coarse but rejects fine values (coords/postcodes)', () => {
    expect(bucketsFor('place')).toBeNull();
    expect(isValidValue('place', 'Groningen')).toBe(true);
    expect(isValidValue('place', '53.2194,6.5665')).toBe(false); // coordinates
    expect(isValidValue('place', '9712CP')).toBe(false);         // postcode
    expect(isValidValue('place', '')).toBe(false);
  });

  it('bucketCount weighs place heavily for the warning heuristic', () => {
    expect(bucketCount('ageBand')).toBe(4);
    expect(bucketCount('place')).toBeGreaterThan(100);
  });
});
