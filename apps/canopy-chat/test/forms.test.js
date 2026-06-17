/**
 * canopy-chat — form generator tests.  v0.3 sub-slice 3.3.
 */
import { describe, it, expect } from 'vitest';

import {
  buildFormSpec, pickStrategy, validateAndCoerce,
} from '../src/forms/buildFormSpec.js';

describe('pickStrategy', () => {
  it("1 simple missing → 'sequential'", () => {
    expect(pickStrategy(
      [{ name: 'a', kind: 'string', required: true }],
      ['a'],
    )).toBe('sequential');
  });

  it("2 simple missing → 'inline'", () => {
    expect(pickStrategy(
      [{ name: 'a', kind: 'string' }, { name: 'b', kind: 'number' }],
      ['a', 'b'],
    )).toBe('inline');
  });

  it("3 simple missing → 'inline'", () => {
    expect(pickStrategy(
      [
        { name: 'a', kind: 'string' },
        { name: 'b', kind: 'number' },
        { name: 'c', kind: 'enum', of: ['x','y'] },
      ],
      ['a', 'b', 'c'],
    )).toBe('inline');
  });

  it("4+ simple missing → 'mini-page'", () => {
    expect(pickStrategy(
      [
        { name: 'a', kind: 'string' }, { name: 'b', kind: 'string' },
        { name: 'c', kind: 'string' }, { name: 'd', kind: 'string' },
      ],
      ['a', 'b', 'c', 'd'],
    )).toBe('mini-page');
  });

  it("ANY complex kind → 'mini-page'", () => {
    expect(pickStrategy(
      [{ name: 'when', kind: 'date', required: true }],
      ['when'],
    )).toBe('mini-page');
    expect(pickStrategy(
      [
        { name: 'a', kind: 'string', required: true },
        { name: 'who', kind: 'webid', required: true },
      ],
      ['a', 'who'],
    )).toBe('mini-page');
  });

  it("0 missing → 'inline' (defensive default; router shouldn't emit needsForm in this case)", () => {
    expect(pickStrategy([{ name: 'a', kind: 'string' }], [])).toBe('inline');
  });
});

describe('buildFormSpec', () => {
  it('emits one field per op param', () => {
    const spec = buildFormSpec({
      opParams: [
        { name: 'text', kind: 'string', required: true },
        { name: 'due',  kind: 'date',                   },
      ],
      missing: ['text'],
      prefilledArgs: {},
      opId: 'addTask', appOrigin: 'tasks',
    });
    expect(spec.opId).toBe('addTask');
    expect(spec.appOrigin).toBe('tasks');
    expect(spec.fields.length).toBe(2);
    expect(spec.fields[0]).toMatchObject({
      name: 'text', kind: 'string', required: true,
    });
    expect(spec.fields[1].kind).toBe('date');
    expect(spec.missing).toEqual(['text']);
    // Only `text` is missing (simple kind) → 'sequential'.  Strategy
    // is driven by what NEEDS user input, not by all op params.
    expect(spec.strategy).toBe('sequential');
  });

  it('marks prefilled fields with .value + readOnly when not in missing', () => {
    const spec = buildFormSpec({
      opParams: [
        { name: 'who',  kind: 'string', required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      missing: ['text'],
      prefilledArgs: { who: 'Anne' },
      opId: 'x', appOrigin: 'a',
    });
    const who  = spec.fields.find((f) => f.name === 'who');
    const text = spec.fields.find((f) => f.name === 'text');
    expect(who.value).toBe('Anne');
    expect(who.readOnly).toBe(true);
    expect(text.value).toBeUndefined();
    expect(text.readOnly).toBe(false);
  });

  it('enum params carry choices', () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'k', kind: 'enum', of: ['x','y','z'], required: true }],
      missing: ['k'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    expect(spec.fields[0].choices).toEqual(['x','y','z']);
  });

  it('labelKey + placeholder + hint passed through', () => {
    const spec = buildFormSpec({
      opParams: [{
        name: 't', kind: 'string', required: true,
        labelKey: 'tasks.text_label', placeholder: 'e.g. fix back door',
        hint: 'A short description',
      }],
      missing: ['t'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    expect(spec.fields[0]).toMatchObject({
      labelKey:    'tasks.text_label',
      placeholder: 'e.g. fix back door',
      hint:        'A short description',
    });
  });

  it('threadId passed through', () => {
    const spec = buildFormSpec({
      opParams: [], missing: [], prefilledArgs: {},
      opId: 'x', appOrigin: 'a', threadId: 't-7',
    });
    expect(spec.threadId).toBe('t-7');
  });

  it("rejects non-array opParams", () => {
    expect(() => buildFormSpec({ opParams: null })).toThrow();
  });
});

describe('validateAndCoerce', () => {
  const spec = (fields) => ({
    opId: 'x', appOrigin: 'a', threadId: null,
    fields, missing: [], strategy: 'inline',
  });

  it('coerces number strings', () => {
    const r = validateAndCoerce(spec([
      { name: 'n', kind: 'number', required: true },
    ]), { n: '42' });
    expect(r).toEqual({ ok: true, args: { n: 42 } });
  });

  it('rejects bad numbers', () => {
    const r = validateAndCoerce(spec([
      { name: 'n', kind: 'number', required: true },
    ]), { n: 'oops' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ field: 'n' });
  });

  it("coerces boolean inputs ('on', 'true', '1', true)", () => {
    const fs = spec([{ name: 'b', kind: 'boolean' }]);
    expect(validateAndCoerce(fs, { b: 'on'   }).args.b).toBe(true);
    expect(validateAndCoerce(fs, { b: 'true' }).args.b).toBe(true);
    expect(validateAndCoerce(fs, { b: '1'    }).args.b).toBe(true);
    expect(validateAndCoerce(fs, { b: true   }).args.b).toBe(true);
    expect(validateAndCoerce(fs, { b: ''     }).ok).toBe(true);   // boolean empty = absent
  });

  it('rejects enum values outside choices', () => {
    const r = validateAndCoerce(spec([
      { name: 'k', kind: 'enum', choices: ['a','b'], required: true },
    ]), { k: 'c' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/not one of a\|b/);
  });

  it('accepts valid enum values', () => {
    const r = validateAndCoerce(spec([
      { name: 'k', kind: 'enum', choices: ['a','b'], required: true },
    ]), { k: 'a' });
    expect(r).toEqual({ ok: true, args: { k: 'a' } });
  });

  it("required-and-missing → error", () => {
    const r = validateAndCoerce(spec([
      { name: 'x', kind: 'string', required: true },
    ]), {});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toEqual({ field: 'x', message: 'required' });
  });

  it("prefilled values pass through when input is empty", () => {
    const r = validateAndCoerce(spec([
      { name: 'who', kind: 'string', required: true, value: 'Anne', readOnly: true },
    ]), {});
    expect(r).toEqual({ ok: true, args: { who: 'Anne' } });
  });

  it("optional missing is fine (no error, no arg)", () => {
    const r = validateAndCoerce(spec([
      { name: 'x', kind: 'string' },
    ]), {});
    expect(r).toEqual({ ok: true, args: {} });
  });
});
