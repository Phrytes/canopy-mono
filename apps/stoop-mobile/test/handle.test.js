/**
 * handle — pure-helper coverage for ProfileMineScreen's client-side
 * handle validator.
 */

import { describe, it, expect } from 'vitest';
import { validateHandle, normaliseHandle, HANDLE_LIMITS } from '../src/lib/handle.js';

describe('validateHandle', () => {
  it('accepts a typical handle', () => {
    expect(validateHandle('oosterpoort-bird-23')).toEqual({ ok: true });
    expect(validateHandle('anne')).toEqual({ ok: true });
    expect(validateHandle('a1b')).toEqual({ ok: true });
  });
  it('rejects empty', () => {
    expect(validateHandle('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(null)).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejects too short', () => {
    expect(validateHandle('a')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateHandle('ab')).toEqual({ ok: false, reason: 'too_short' });
  });
  it('rejects too long', () => {
    const tooLong = 'a'.repeat(HANDLE_LIMITS.maxLen + 1);
    expect(validateHandle(tooLong)).toEqual({ ok: false, reason: 'too_long' });
  });
  it('rejects uppercase / spaces / disallowed chars', () => {
    expect(validateHandle('Anne')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('an ne')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('an@ne')).toEqual({ ok: false, reason: 'bad_chars' });
  });
  it('rejects leading / trailing separators', () => {
    expect(validateHandle('-anne')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('anne-')).toEqual({ ok: false, reason: 'bad_chars' });
    expect(validateHandle('_anne')).toEqual({ ok: false, reason: 'bad_chars' });
  });
});

describe('normaliseHandle', () => {
  it('lowercases', () => {
    expect(normaliseHandle('ANNE-23')).toBe('anne-23');
  });
  it('drops disallowed chars', () => {
    expect(normaliseHandle('anne van dijk')).toBe('annevandijk');
    expect(normaliseHandle('anne@example.com')).toBe('anneexamplecom');
  });
  it('handles non-string input', () => {
    expect(normaliseHandle(null)).toBe('');
    expect(normaliseHandle(undefined)).toBe('');
    expect(normaliseHandle(42)).toBe('');
  });
});

describe('HANDLE_LIMITS', () => {
  it('exposes 3-32', () => {
    expect(HANDLE_LIMITS.minLen).toBe(3);
    expect(HANDLE_LIMITS.maxLen).toBe(32);
  });
});
