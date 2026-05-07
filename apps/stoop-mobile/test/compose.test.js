/**
 * compose — pure-helper coverage for PostComposeScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  validateDraft, remainingChars, removeAttachmentAt, capAttachments,
  MAX_ATTACHMENTS, MAX_BODY_LEN, VALID_KINDS,
} from '../src/lib/compose.js';

describe('validateDraft', () => {
  it('accepts a typical vraag', () => {
    expect(validateDraft({ text: 'Hi', kind: 'vraag', attachments: [] })).toEqual({ ok: true });
  });
  it('accepts an aanbod', () => {
    expect(validateDraft({ text: 'Help!', kind: 'aanbod' })).toEqual({ ok: true });
  });
  it('rejects empty text', () => {
    expect(validateDraft({ text: '', kind: 'vraag' })).toEqual({ ok: false, reason: 'no_text' });
    expect(validateDraft({ text: '   ', kind: 'vraag' })).toEqual({ ok: false, reason: 'no_text' });
  });
  it('rejects too-long text', () => {
    expect(validateDraft({ text: 'a'.repeat(MAX_BODY_LEN + 1), kind: 'vraag' }))
      .toEqual({ ok: false, reason: 'too_long' });
  });
  it('rejects bad kind', () => {
    expect(validateDraft({ text: 'x', kind: 'unknown' })).toEqual({ ok: false, reason: 'bad_kind' });
    expect(validateDraft({ text: 'x' })).toEqual({ ok: false, reason: 'bad_kind' });
  });
  it('rejects too many attachments', () => {
    const atts = Array(MAX_ATTACHMENTS + 1).fill({});
    expect(validateDraft({ text: 'x', kind: 'vraag', attachments: atts }))
      .toEqual({ ok: false, reason: 'too_many_attachments' });
  });
  it('rejects null', () => {
    expect(validateDraft(null).ok).toBe(false);
  });
  it('exposes the valid kinds', () => {
    expect(VALID_KINDS).toContain('vraag');
    expect(VALID_KINDS).toContain('aanbod');
  });
});

describe('remainingChars', () => {
  it('counts down from MAX_BODY_LEN', () => {
    expect(remainingChars('')).toBe(MAX_BODY_LEN);
    expect(remainingChars('hi')).toBe(MAX_BODY_LEN - 2);
  });
  it('clamps to 0 (never negative)', () => {
    expect(remainingChars('a'.repeat(MAX_BODY_LEN + 50))).toBe(0);
  });
  it('falls back to MAX on non-strings', () => {
    expect(remainingChars(null)).toBe(MAX_BODY_LEN);
  });
});

describe('removeAttachmentAt + capAttachments', () => {
  it('removes the i-th item', () => {
    expect(removeAttachmentAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('returns a copy when idx is out of range', () => {
    const a = ['a'];
    const b = removeAttachmentAt(a, -1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
  });
  it('caps at MAX_ATTACHMENTS', () => {
    const a = Array(MAX_ATTACHMENTS + 3).fill('x');
    expect(capAttachments(a)).toHaveLength(MAX_ATTACHMENTS);
  });
  it('preserves shorter lists', () => {
    expect(capAttachments(['a', 'b'])).toEqual(['a', 'b']);
  });
});
