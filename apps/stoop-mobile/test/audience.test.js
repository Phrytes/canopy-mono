/**
 * audience — pure-helper coverage for the AudiencePicker.
 */

import { describe, it, expect } from 'vitest';
import {
  targetsEqual, isTargetSelected, toggleTarget,
  snapDistance, DISTANCE_PRESETS,
} from '../src/lib/audience.js';

describe('targetsEqual', () => {
  it('matches groups by groupId', () => {
    expect(targetsEqual({ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g1' })).toBe(true);
    expect(targetsEqual({ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g2' })).toBe(false);
  });
  it('matches contacts by webid (or stableId fallback)', () => {
    expect(targetsEqual({ kind: 'contact', webid: 'w' }, { kind: 'contact', webid: 'w' })).toBe(true);
    expect(targetsEqual({ kind: 'contact', stableId: 's' }, { kind: 'contact', webid: 's' })).toBe(true);
    expect(targetsEqual({ kind: 'contact', webid: 'w' }, { kind: 'contact', webid: 'x' })).toBe(false);
  });
  it('returns false across kinds + on null input', () => {
    expect(targetsEqual({ kind: 'group', groupId: 'g' }, { kind: 'contact', webid: 'g' })).toBe(false);
    expect(targetsEqual(null, { kind: 'group' })).toBe(false);
    expect(targetsEqual({ kind: 'group' }, null)).toBe(false);
  });
});

describe('isTargetSelected', () => {
  it('detects membership', () => {
    const sel = [{ kind: 'group', groupId: 'g1' }];
    expect(isTargetSelected(sel, { kind: 'group', groupId: 'g1' })).toBe(true);
    expect(isTargetSelected(sel, { kind: 'group', groupId: 'g2' })).toBe(false);
  });
  it('handles non-array', () => {
    expect(isTargetSelected(null, { kind: 'group', groupId: 'g' })).toBe(false);
  });
});

describe('toggleTarget', () => {
  it('adds when absent', () => {
    const r = toggleTarget([], { kind: 'group', groupId: 'g1' });
    expect(r).toEqual([{ kind: 'group', groupId: 'g1' }]);
  });
  it('removes when present', () => {
    const r = toggleTarget([{ kind: 'group', groupId: 'g1' }], { kind: 'group', groupId: 'g1' });
    expect(r).toEqual([]);
  });
  it('preserves other entries', () => {
    const r = toggleTarget(
      [{ kind: 'group', groupId: 'g1' }, { kind: 'contact', webid: 'w' }],
      { kind: 'group', groupId: 'g1' },
    );
    expect(r).toEqual([{ kind: 'contact', webid: 'w' }]);
  });
  it('returns a new array', () => {
    const orig = [{ kind: 'group', groupId: 'g1' }];
    const r = toggleTarget(orig, { kind: 'group', groupId: 'g2' });
    expect(r).not.toBe(orig);
  });
});

describe('snapDistance', () => {
  it('snaps to the nearest preset', () => {
    expect(snapDistance(0.5)).toBe(1);
    expect(snapDistance(2.5)).toBe(2);
    expect(snapDistance(7)).toBe(5);
    expect(snapDistance(15)).toBe(10);
    expect(snapDistance(25)).toBe(25);
    expect(snapDistance(100)).toBe(25);
  });
  it('null for invalid', () => {
    expect(snapDistance(null)).toBeNull();
    expect(snapDistance(NaN)).toBeNull();
    expect(snapDistance('x')).toBeNull();
  });
  it('exposes the presets', () => {
    expect(DISTANCE_PRESETS).toEqual([1, 2, 5, 10, 25]);
  });
});
