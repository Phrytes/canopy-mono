/**
 * defineProtocol — declarative validation.
 */

import { describe, it, expect } from 'vitest';
import { defineProtocol, findTransition } from '../src/defineProtocol.js';

const SIMPLE = {
  id:      'test',
  initial: 'a',
  states:  ['a', 'b'],
  transitions: [
    { from: 'a', event: 'go', to: 'b' },
  ],
};

describe('defineProtocol — input validation', () => {
  it('rejects missing id / initial / states / transitions', () => {
    expect(() => defineProtocol({})).toThrow(/id/);
    expect(() => defineProtocol({ id: 'x' })).toThrow(/initial/);
    expect(() => defineProtocol({ id: 'x', initial: 'a' })).toThrow(/states/);
    expect(() => defineProtocol({ id: 'x', initial: 'a', states: ['a'] })).toThrow(/transitions/);
  });

  it('rejects initial not in states', () => {
    expect(() => defineProtocol({
      id: 'x', initial: 'a', states: ['b'], transitions: [],
    })).toThrow(/initial.*not in states/);
  });

  it('rejects transition with unknown from / to', () => {
    expect(() => defineProtocol({
      id: 'x', initial: 'a', states: ['a', 'b'],
      transitions: [{ from: 'a', event: 'go', to: 'ghost' }],
    })).toThrow(/transition\.to/);
    expect(() => defineProtocol({
      id: 'x', initial: 'a', states: ['a', 'b'],
      transitions: [{ from: 'ghost', event: 'go', to: 'b' }],
    })).toThrow(/transition\.from/);
  });

  it('rejects transition without event', () => {
    expect(() => defineProtocol({
      id: 'x', initial: 'a', states: ['a', 'b'],
      transitions: [{ from: 'a', to: 'b' }],
    })).toThrow(/event/);
  });

  it('rejects unknown top-level keys', () => {
    expect(() => defineProtocol({ ...SIMPLE, extraneous: true }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('defineProtocol — return shape', () => {
  it('returns a frozen object with defaults', () => {
    const def = defineProtocol(SIMPLE);
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.states)).toBe(true);
    expect(Object.isFrozen(def.transitions)).toBe(true);
    expect(def.name).toBe(def.id);   // defaults to id
  });

  it('uses caller-supplied name', () => {
    const def = defineProtocol({ ...SIMPLE, name: 'My Test' });
    expect(def.name).toBe('My Test');
  });
});

describe('findTransition', () => {
  it('returns the matching transition', () => {
    const def = defineProtocol(SIMPLE);
    const t = findTransition(def, 'a', 'go');
    expect(t?.to).toBe('b');
  });

  it('returns null for state with no matching event', () => {
    const def = defineProtocol(SIMPLE);
    expect(findTransition(def, 'a', 'nope')).toBe(null);
    expect(findTransition(def, 'b', 'go')).toBe(null);
  });
});
