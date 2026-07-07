/**
 * photoPresets — unit coverage for the path scheme + id generator.
 *
 * Phase 41.5.6 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import {
  DELIVERABLE_PRESET, AVATAR_PRESET, deliverableRef, photoId,
} from '../../src/lib/photoPresets.js';

describe('photoPresets — preset shape', () => {
  it('DELIVERABLE_PRESET matches the desktop web-side resize numbers', () => {
    expect(DELIVERABLE_PRESET.maxEdgePx).toBe(1280);
    expect(DELIVERABLE_PRESET.thumbEdgePx).toBe(120);
    expect(DELIVERABLE_PRESET.quality).toBe(0.82);
  });
  it('AVATAR_PRESET is square-ish and small', () => {
    expect(AVATAR_PRESET.maxEdgePx).toBe(256);
    expect(AVATAR_PRESET.thumbEdgePx).toBe(64);
  });
});

describe('photoPresets.deliverableRef', () => {
  it('anchors photos under the circle\'s namespace', () => {
    const ref = deliverableRef({ circleId: 'circle-a', taskId: 'urn:uuid:t1', photoId: 'abc' });
    expect(ref).toBe('mem://tasks/circles/circle-a/deliverables/urn:uuid:t1/abc.jpg');
  });
  it('throws when any required field is missing', () => {
    expect(() => deliverableRef({ taskId: 't1', photoId: 'p' })).toThrow(/circleId/);
    expect(() => deliverableRef({ circleId: 'c', photoId: 'p' })).toThrow(/taskId/);
    expect(() => deliverableRef({ circleId: 'c', taskId: 't1' })).toThrow(/photoId/);
  });
});

describe('photoPresets.photoId', () => {
  it('returns 8 alphanumeric characters', () => {
    const id = photoId();
    expect(typeof id).toBe('string');
    expect(id.length).toBe(8);
    expect(/^[A-Za-z0-9]{8}$/.test(id)).toBe(true);
  });
  it('honours an injected rng for determinism', () => {
    const id = photoId(() => 0);
    expect(id).toBe('AAAAAAAA');
  });
});
