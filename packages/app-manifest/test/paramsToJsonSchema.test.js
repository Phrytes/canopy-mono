import { describe, it, expect } from 'vitest';
import { paramsToJsonSchema } from '../src/index.js';

describe('paramsToJsonSchema', () => {
  it('empty params → empty object schema (no `required` key when empty)', () => {
    const out = paramsToJsonSchema([]);
    expect(out).toEqual({ type: 'object', properties: {} });
    expect(out).not.toHaveProperty('required');
  });

  it('non-array → treated as empty (no `required` key)', () => {
    const out = paramsToJsonSchema(undefined);
    expect(out).toEqual({ type: 'object', properties: {} });
    expect(out).not.toHaveProperty('required');
  });

  it('F-SP1-c: Param.schema fragment is spread after `type`', () => {
    const out = paramsToJsonSchema([
      { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
      { name: 'n',    kind: 'number',                  schema: { minimum: 0 } },
    ]);
    expect(out.properties.text).toEqual({ type: 'string', minLength: 1 });
    expect(out.properties.n).toEqual({ type: 'number', minimum: 0 });
    // Key order: type first, then the spread fragment.
    expect(Object.keys(out.properties.text)).toEqual(['type', 'minLength']);
    expect(Object.keys(out.properties.n)).toEqual(['type', 'minimum']);
    expect(out.required).toEqual(['text']);
  });

  it('F-SP1-c: Param.schema works with enum kind too', () => {
    const out = paramsToJsonSchema([
      { name: 'col', kind: 'enum', of: ['r', 'g', 'b'], required: true, schema: { default: 'r' } },
    ]);
    expect(out.properties.col).toEqual({ type: 'string', enum: ['r', 'g', 'b'], default: 'r' });
    expect(Object.keys(out.properties.col)).toEqual(['type', 'enum', 'default']);
  });

  it('maps string / number / boolean kinds', () => {
    const out = paramsToJsonSchema([
      { name: 's', kind: 'string',  required: true },
      { name: 'n', kind: 'number'                  },
      { name: 'b', kind: 'boolean', required: true },
    ]);
    expect(out.properties).toEqual({
      s: { type: 'string'  },
      n: { type: 'number'  },
      b: { type: 'boolean' },
    });
    expect(out.required).toEqual(['s', 'b']);
  });

  it('preserves param order in properties + required', () => {
    const out = paramsToJsonSchema([
      { name: 'z', kind: 'string', required: true },
      { name: 'a', kind: 'string'                  },
      { name: 'm', kind: 'string', required: true },
    ]);
    expect(Object.keys(out.properties)).toEqual(['z', 'a', 'm']);
    expect(out.required).toEqual(['z', 'm']);
  });

  it('enum with inline array', () => {
    const out = paramsToJsonSchema([
      { name: 'col', kind: 'enum', of: ['red', 'green', 'blue'], required: true },
    ]);
    expect(out.properties.col).toEqual({ type: 'string', enum: ['red', 'green', 'blue'] });
    expect(out.required).toEqual(['col']);
  });

  it("enum with of:'itemTypes' resolves against manifest.itemTypes", () => {
    const manifest = { itemTypes: ['note', 'task'] };
    const out = paramsToJsonSchema(
      [{ name: 't', kind: 'enum', of: 'itemTypes', required: true }],
      { manifest },
    );
    expect(out.properties.t).toEqual({ type: 'string', enum: ['note', 'task'] });
  });

  it("enum with of:'itemTypes' without manifest throws", () => {
    expect(() =>
      paramsToJsonSchema([{ name: 't', kind: 'enum', of: 'itemTypes', required: true }]),
    ).toThrow(/itemTypes/);
  });

  it('unknown kind throws', () => {
    expect(() =>
      paramsToJsonSchema([{ name: 'x', kind: 'blob' }]),
    ).toThrow(/unknown kind/);
  });

  it("unsupported 'of' string throws", () => {
    expect(() =>
      paramsToJsonSchema([{ name: 'x', kind: 'enum', of: 'colours' }]),
    ).toThrow(/unsupported 'of'/);
  });
});
