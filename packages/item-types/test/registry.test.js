/**
 * Registry — unit tests.
 *
 * Covers:
 *   - createRegistry() returns a fresh, isolated instance.
 *   - registerType(name, schema) validates inputs + compiles
 *     the schema.
 *   - Duplicate registration throws.
 *   - validate() against a registered type passes/fails as expected.
 *   - validate() with unknown type reports an error.
 *   - validate() with bad item shape reports an error.
 *   - schema() / metadata() / list() work correctly.
 *   - Aliases resolve to the canonical type.
 *   - Invalid schemas throw with INVALID_SCHEMA code.
 *   - Custom `iri` + `description` schema metadata is preserved.
 */

import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/registry.js';

const SCHEMA_A = {
  iri:         'https://example.org/A',
  description: 'A test schema',
  type:        'object',
  required:    ['type', 'name'],
  properties: {
    type: { const: 'a' },
    name: { type: 'string', minLength: 1 },
    extra: { type: 'number' },
  },
};

describe('createRegistry', () => {
  it('returns an isolated instance', () => {
    const r1 = createRegistry();
    const r2 = createRegistry();
    r1.registerType('a', SCHEMA_A);
    expect(r1.list()).toEqual(['a']);
    expect(r2.list()).toEqual([]);
  });
});

describe('registry.registerType', () => {
  it('registers a valid schema', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    expect(r.list()).toEqual(['a']);
    expect(r.schema('a')).toBe(SCHEMA_A);
  });

  it('throws on empty name', () => {
    const r = createRegistry();
    expect(() => r.registerType('', SCHEMA_A))
      .toThrow(/non-empty/);
    expect(() => r.registerType(null, SCHEMA_A))
      .toThrow(/non-empty/);
  });

  it('throws on duplicate name', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    expect(() => r.registerType('a', SCHEMA_A))
      .toThrowError(expect.objectContaining({ code: 'DUPLICATE_TYPE' }));
  });

  it('throws INVALID_SCHEMA when the schema fails to compile', () => {
    const r = createRegistry();
    // `not: true` is an invalid keyword shape — ajv rejects.
    expect(() => r.registerType('bad', { type: 'object', properties: { x: { type: 'not-a-real-type' } } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
  });

  it('accepts iri + description metadata without complaining', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    expect(r.metadata('a')).toEqual({ name: 'a', iri: 'https://example.org/A' });
  });

  it('registers aliases that resolve to the canonical name', () => {
    const r = createRegistry();
    r.registerType('thing', SCHEMA_A, { aliases: ['legacy-thing', 'old-name'] });
    expect(r.listAliases()).toEqual({ 'legacy-thing': 'thing', 'old-name': 'thing' });
    expect(r.metadata('legacy-thing')?.name).toBe('thing');
    expect(r.schema('old-name')).toBe(SCHEMA_A);
  });
});

describe('registry.validate', () => {
  it('passes a well-shaped item', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);

    const result = r.validate({ type: 'a', name: 'hello' });
    expect(result.ok).toBe(true);
  });

  it('fails on missing required fields', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    const result = r.validate({ type: 'a' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails on type mismatch', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    const result = r.validate({ type: 'a', name: 12345 });
    expect(result.ok).toBe(false);
  });

  it('allows extra fields (forward-compat)', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    const result = r.validate({
      type: 'a',
      name: 'hello',
      unknownField: 'tomorrow this might be standard',
      anotherOne: 42,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects non-object inputs', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    expect(r.validate(null).ok).toBe(false);
    expect(r.validate(undefined).ok).toBe(false);
    expect(r.validate('string').ok).toBe(false);
    expect(r.validate([]).ok).toBe(false);
  });

  it('rejects items without a string `type` field', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    expect(r.validate({}).ok).toBe(false);
    expect(r.validate({ type: 42 }).ok).toBe(false);
    expect(r.validate({ type: '' }).ok).toBe(false);
  });

  it('rejects items with an unknown type', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A);
    const result = r.validate({ type: 'unknown' });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/unknown type/);
  });

  it('resolves alias names to the canonical schema', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A, { aliases: ['alpha'] });
    const result = r.validate({ type: 'alpha', name: 'hello' });
    expect(result.ok).toBe(true);
  });

  it('does not mutate the caller item on alias resolution', () => {
    const r = createRegistry();
    r.registerType('a', SCHEMA_A, { aliases: ['alpha'] });
    const item = { type: 'alpha', name: 'hello' };
    r.validate(item);
    expect(item.type).toBe('alpha');   // unchanged
  });
});

describe('registry.list / metadata / schema accessors', () => {
  it('list() returns sorted canonical names', () => {
    const r = createRegistry();
    r.registerType('zeta', SCHEMA_A);
    r.registerType('alpha', { ...SCHEMA_A, properties: { ...SCHEMA_A.properties, type: { const: 'alpha' } } });
    expect(r.list()).toEqual(['alpha', 'zeta']);
  });

  it('schema(unknown) returns null', () => {
    const r = createRegistry();
    expect(r.schema('nope')).toBe(null);
  });

  it('metadata(unknown) returns null', () => {
    const r = createRegistry();
    expect(r.metadata('nope')).toBe(null);
  });
});
