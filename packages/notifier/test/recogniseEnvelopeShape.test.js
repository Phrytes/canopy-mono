/**
 * recogniseEnvelopeShape — pure detector.
 */

import { describe, it, expect } from 'vitest';
import { recogniseEnvelopeShape } from '../src/recogniseEnvelopeShape.js';

describe('recogniseEnvelopeShape', () => {
  it('accepts the minimal envelope shape', () => {
    expect(recogniseEnvelopeShape({ kind: 'task', ref: 'pseudo-pod://x' })).toBe(true);
  });

  it('accepts envelopes with extra fields', () => {
    expect(recogniseEnvelopeShape({
      kind: 'announcement',
      ref:  'https://anne.pod/x',
      etag: '"v1"',
      payload: { body: 'hi' },
      fromActor: 'agent://anne',
    })).toBe(true);
  });

  it('rejects chat-shaped builder outputs', () => {
    expect(recogniseEnvelopeShape({ text: 'hello', buttons: [] })).toBe(false);
  });

  it('rejects missing kind', () => {
    expect(recogniseEnvelopeShape({ ref: 'x' })).toBe(false);
  });

  it('rejects missing ref', () => {
    expect(recogniseEnvelopeShape({ kind: 'task' })).toBe(false);
  });

  it('rejects non-string kind / ref', () => {
    expect(recogniseEnvelopeShape({ kind: 42, ref: 'x' })).toBe(false);
    expect(recogniseEnvelopeShape({ kind: 'task', ref: null })).toBe(false);
    expect(recogniseEnvelopeShape({ kind: '', ref: 'x' })).toBe(false);
    expect(recogniseEnvelopeShape({ kind: 'task', ref: '' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(recogniseEnvelopeShape(null)).toBe(false);
    expect(recogniseEnvelopeShape(undefined)).toBe(false);
    expect(recogniseEnvelopeShape('string')).toBe(false);
    expect(recogniseEnvelopeShape([])).toBe(false);
  });
});
