/**
 * mnemonic — pure-helper coverage for OnboardRestoreScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseMnemonic, mnemonicWords,
  hasValidWordCount, looksLikeMnemonic, statusFor,
  BIP39_WORD_COUNTS,
} from '../src/lib/mnemonic.js';

const TWELVE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const TWENTY_FOUR = TWELVE + ' ' + TWELVE;

describe('normaliseMnemonic', () => {
  it('lowercases', () => {
    expect(normaliseMnemonic('ABANDON ABILITY')).toBe('abandon ability');
  });
  it('collapses whitespace', () => {
    expect(normaliseMnemonic('abandon\t \nability')).toBe('abandon ability');
  });
  it('trims', () => {
    expect(normaliseMnemonic('   abandon ability   ')).toBe('abandon ability');
  });
  it('handles non-string input', () => {
    expect(normaliseMnemonic(undefined)).toBe('');
    expect(normaliseMnemonic(null)).toBe('');
    expect(normaliseMnemonic(42)).toBe('');
  });
});

describe('mnemonicWords', () => {
  it('splits a 12-word phrase', () => {
    expect(mnemonicWords(TWELVE)).toHaveLength(12);
  });
  it('returns [] for empty input', () => {
    expect(mnemonicWords('')).toEqual([]);
    expect(mnemonicWords('   ')).toEqual([]);
  });
});

describe('hasValidWordCount + looksLikeMnemonic', () => {
  it('accepts every BIP-39 word count', () => {
    for (const n of BIP39_WORD_COUNTS) {
      const phrase = Array(n).fill('abandon').join(' ');
      expect(hasValidWordCount(phrase)).toBe(true);
      expect(looksLikeMnemonic(phrase)).toBe(true);
    }
  });
  it('rejects 13-word phrases', () => {
    expect(hasValidWordCount(TWELVE + ' extra')).toBe(false);
    expect(looksLikeMnemonic(TWELVE + ' extra')).toBe(false);
  });
  it('looksLikeMnemonic rejects words with digits', () => {
    expect(looksLikeMnemonic(TWELVE.replace('ability', 'a1bility'))).toBe(false);
  });
  it('looksLikeMnemonic accepts uppercase via normalisation', () => {
    // mnemonicWords lowercases first, so uppercase is fine.
    expect(looksLikeMnemonic('ABANDON '.repeat(12).trim())).toBe(true);
  });
});

describe('statusFor', () => {
  it('returns empty for empty input', () => {
    expect(statusFor('')).toBe('empty');
  });
  it('returns too_short for 1-3 words', () => {
    expect(statusFor('abandon')).toBe('too_short');
    expect(statusFor('abandon ability able')).toBe('too_short');
  });
  it('returns wrong_count for 4-11 words and odd counts', () => {
    expect(statusFor(Array(5).fill('abandon').join(' '))).toBe('wrong_count');
    expect(statusFor(Array(11).fill('abandon').join(' '))).toBe('wrong_count');
    expect(statusFor(Array(13).fill('abandon').join(' '))).toBe('wrong_count');
    expect(statusFor(Array(25).fill('abandon').join(' '))).toBe('wrong_count');
  });
  it('returns looks_ok for valid BIP-39 lengths', () => {
    expect(statusFor(TWELVE)).toBe('looks_ok');
    expect(statusFor(TWENTY_FOUR)).toBe('looks_ok');
  });
  it('returns malformed_word for non-letter or out-of-range words', () => {
    expect(statusFor(TWELVE.replace('abandon', 'ab1andon'))).toBe('malformed_word');
    expect(statusFor(TWELVE.replace('abandon', 'antidisestablishment'))).toBe('malformed_word');
    expect(statusFor(TWELVE.replace('abandon', 'ab'))).toBe('malformed_word');
  });
});
