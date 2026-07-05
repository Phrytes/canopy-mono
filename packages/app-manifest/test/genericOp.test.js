/** genericOp codec — the synthetic op-id for op-less capabilities round-trips; malformed ids reject. */
import { describe, it, expect } from 'vitest';
import { encodeGenericOpId, isGenericOpId, decodeGenericOpId } from '../src/genericOp.js';

describe('generic op-id codec (§1b)', () => {
  it('encodes + decodes round-trip', () => {
    const id = encodeGenericOpId('household', 'add', 'note');
    expect(id).toBe('__generic__:household:add:note');
    expect(isGenericOpId(id)).toBe(true);
    expect(decodeGenericOpId(id)).toEqual({ app: 'household', atom: 'add', noun: 'note' });
  });

  it('a real op-id is not generic and decodes to null', () => {
    expect(isGenericOpId('addTask')).toBe(false);
    expect(decodeGenericOpId('addTask')).toBe(null);
    expect(decodeGenericOpId(undefined)).toBe(null);
    expect(decodeGenericOpId('__generic__:household:add')).toBe(null);   // too few parts
  });
});
