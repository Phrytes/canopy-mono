/**
 * V0.2 — `schemaToFormFields` helper.
 *
 * Walks paramsSchema → platform-neutral form-field descriptors.
 * Adapters (web HTML, mobile RN) render the same descriptors as
 * different inputs.
 */

import { describe, it, expect } from 'vitest';

import { schemaToFormFields } from '../src/schemaToFormFields.js';

describe('schemaToFormFields — contract', () => {
  it('returns [] for missing schema', () => {
    expect(schemaToFormFields(null)).toEqual([]);
    expect(schemaToFormFields(undefined)).toEqual([]);
  });

  it('returns [] when schema.type is not "object"', () => {
    expect(schemaToFormFields({ type: 'string' })).toEqual([]);
  });

  it('returns [] for empty object schema', () => {
    expect(schemaToFormFields({ type: 'object', properties: {} })).toEqual([]);
  });
});

describe('schemaToFormFields — type derivation', () => {
  it('string property → type:"string"', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(fields).toEqual([{ name: 'text', type: 'string', required: false }]);
  });

  it('number property → type:"number"', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { dueAt: { type: 'number' } },
    });
    expect(fields[0].type).toBe('number');
  });

  it('integer property → type:"number" (collapsed)', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { count: { type: 'integer' } },
    });
    expect(fields[0].type).toBe('number');
  });

  it('boolean property → type:"boolean"', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { flag: { type: 'boolean' } },
    });
    expect(fields[0].type).toBe('boolean');
  });

  it('enum property → type:"enum" + choices[]', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { type: { type: 'string', enum: ['shopping', 'errand'] } },
    });
    expect(fields[0]).toEqual({
      name: 'type', type: 'enum', required: false, choices: ['shopping', 'errand'],
    });
  });

  it('missing type defaults to "string"', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { x: { minLength: 1 } },
    });
    expect(fields[0].type).toBe('string');
  });
});

describe('schemaToFormFields — required flag', () => {
  it('required[] populates field.required = true', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { text: { type: 'string' }, dueAt: { type: 'number' } },
      required: ['text'],
    });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.text.required).toBe(true);
    expect(byName.dueAt.required).toBe(false);
  });

  it('missing required[] → all fields optional', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(fields[0].required).toBe(false);
  });
});

describe('schemaToFormFields — constraints passthrough', () => {
  it('minLength + maxLength forwarded for strings', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 100 } },
    });
    expect(fields[0]).toMatchObject({ minLength: 1, maxLength: 100 });
  });

  it('minimum + maximum forwarded for numbers', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: { dueAt: { type: 'number', minimum: 0, maximum: 9999 } },
    });
    expect(fields[0]).toMatchObject({ min: 0, max: 9999 });
  });
});

describe('schemaToFormFields — Q6 prefilledParams omission', () => {
  const SCHEMA = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['shopping', 'errand'] },
      text: { type: 'string' },
    },
    required: ['type', 'text'],
  };

  it('prefilled fields are OMITTED from the form', () => {
    const fields = schemaToFormFields(SCHEMA, { prefilledParams: { type: 'shopping' } });
    expect(fields.map((f) => f.name)).toEqual(['text']);
  });

  it('no prefilledParams → all fields present', () => {
    const fields = schemaToFormFields(SCHEMA);
    expect(fields.map((f) => f.name).sort()).toEqual(['text', 'type']);
  });

  it('empty prefilledParams object → all fields present', () => {
    const fields = schemaToFormFields(SCHEMA, { prefilledParams: {} });
    expect(fields.map((f) => f.name).sort()).toEqual(['text', 'type']);
  });
});

describe('schemaToFormFields — preserves declaration order', () => {
  it('returns fields in property-declaration order', () => {
    const fields = schemaToFormFields({
      type: 'object',
      properties: {
        text:     { type: 'string' },
        dueAt:    { type: 'number' },
        assignee: { type: 'string' },
      },
    });
    expect(fields.map((f) => f.name)).toEqual(['text', 'dueAt', 'assignee']);
  });
});

describe('schemaToFormFields — real household addTask shape', () => {
  it('addTask schema produces 3 fields (text required, assignee + dueAt optional)', () => {
    // Mirrors the JSON Schema paramsToJsonSchema would produce for
    // household's addTask op.
    const schema = {
      type: 'object',
      properties: {
        text:     { type: 'string', minLength: 1 },
        assignee: { type: 'string' },
        dueAt:    { type: 'number' },
      },
      required: ['text'],
    };
    const fields = schemaToFormFields(schema);
    expect(fields).toEqual([
      { name: 'text',     type: 'string', required: true,  minLength: 1 },
      { name: 'assignee', type: 'string', required: false                 },
      { name: 'dueAt',    type: 'number', required: false                 },
    ]);
  });
});
