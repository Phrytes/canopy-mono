/**
 * negotiateVersion — pure picker for the IHub version handshake.
 */

import { describe, it, expect } from 'vitest';
import { negotiateVersion } from '../../src/hub-binding/versionNegotiation.js';

describe('negotiateVersion', () => {
  it('picks the highest shared version', () => {
    expect(negotiateVersion({ clientVersions: [1, 2], hubVersions: [1, 2] })).toBe(2);
  });

  it('falls back to V1 when Hub is V1-only', () => {
    expect(negotiateVersion({ clientVersions: [1, 2], hubVersions: [1] })).toBe(1);
  });

  it('falls back to V1 when client is V1-only', () => {
    expect(negotiateVersion({ clientVersions: [1], hubVersions: [1, 2] })).toBe(1);
  });

  it('throws NO_COMPATIBLE_VERSION when no overlap', () => {
    expect(() => negotiateVersion({ clientVersions: [2], hubVersions: [1] }))
      .toThrowError(expect.objectContaining({ code: 'NO_COMPATIBLE_VERSION' }));
  });

  it('error carries both arrays for telemetry', () => {
    try {
      negotiateVersion({ clientVersions: [3], hubVersions: [1, 2] });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err.clientVersions).toEqual([3]);
      expect(err.hubVersions).toEqual([1, 2]);
    }
  });

  it('rejects empty or missing arrays', () => {
    expect(() => negotiateVersion({ clientVersions: [],  hubVersions: [1] })).toThrow(/clientVersions/);
    expect(() => negotiateVersion({ clientVersions: [1], hubVersions: [] })).toThrow(/hubVersions/);
    expect(() => negotiateVersion({})).toThrow();
  });
});
