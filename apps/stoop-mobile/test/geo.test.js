/**
 * geo (mobile) tests — `getCoarseLocationFromGps` permission +
 * coordinate handling, plus `cellFor` re-export parity with
 * `@canopy-app/stoop/lib/geo`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getCoarseLocationFromGps,
  cellFor,
  cellCenter,
  distanceKm,
  snapToGrid,
  DISTANCE_PRESETS,
  GEO_DEFAULTS,
} from '../src/lib/geo.js';

function makeLocationStub({
  permission = 'granted',
  coords = { latitude: 53.2, longitude: 6.6 },
  fail = false,
} = {}) {
  return {
    requestForegroundPermissionsAsync: vi.fn(async () => ({ status: permission })),
    getCurrentPositionAsync: vi.fn(async () => {
      if (fail) throw new Error('GPS unavailable');
      return { coords };
    }),
    Accuracy: { Low: 1, Balanced: 3, High: 4 },
  };
}

describe('cell helper re-exports', () => {
  it('match Stoop\'s desktop helpers', () => {
    expect(typeof cellFor).toBe('function');
    expect(typeof cellCenter).toBe('function');
    expect(typeof distanceKm).toBe('function');
    expect(typeof snapToGrid).toBe('function');
    expect(Array.isArray(DISTANCE_PRESETS)).toBe(true);
    expect(GEO_DEFAULTS.gridM).toBeGreaterThan(0);
  });

  it('cellFor produces deterministic ids', () => {
    const a = cellFor({ lat: 53.2, lng: 6.6 });
    const b = cellFor({ lat: 53.2001, lng: 6.6001 });
    expect(a).toBe(b);
  });
});

describe('getCoarseLocationFromGps', () => {
  it('returns {cell, label, source, lat, lng} on the happy path', async () => {
    const Loc = makeLocationStub({ coords: { latitude: 53.2, longitude: 6.6 } });
    const res = await getCoarseLocationFromGps({ LocationModule: Loc });
    expect(res.source).toBe('gps');
    expect(res.label).toBeNull();
    expect(typeof res.cell).toBe('string');
    expect(res.lat).toBe(53.2);
    expect(res.lng).toBe(6.6);
    expect(Loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Loc.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('cell matches the desktop cellFor for the same coords', async () => {
    const Loc = makeLocationStub({ coords: { latitude: 52.37, longitude: 4.9 } });
    const res = await getCoarseLocationFromGps({ LocationModule: Loc });
    expect(res.cell).toBe(cellFor({ lat: 52.37, lng: 4.9 }));
  });

  it('throws PERMISSION_DENIED when the user rejects', async () => {
    const Loc = makeLocationStub({ permission: 'denied' });
    await expect(getCoarseLocationFromGps({ LocationModule: Loc })).rejects
      .toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(Loc.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('throws PERMISSION_DENIED when status is undetermined', async () => {
    const Loc = makeLocationStub({ permission: 'undetermined' });
    await expect(getCoarseLocationFromGps({ LocationModule: Loc })).rejects
      .toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('throws LOCATION_UNAVAILABLE when getCurrentPositionAsync throws', async () => {
    const Loc = makeLocationStub({ fail: true });
    await expect(getCoarseLocationFromGps({ LocationModule: Loc })).rejects
      .toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
  });

  it('throws LOCATION_UNAVAILABLE when coords are missing', async () => {
    const Loc = {
      requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
      getCurrentPositionAsync: vi.fn(async () => ({ coords: {} })),
      Accuracy: { Low: 1, Balanced: 3, High: 4 },
    };
    await expect(getCoarseLocationFromGps({ LocationModule: Loc })).rejects
      .toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
  });

  it('passes the requested accuracy to expo-location', async () => {
    const Loc = makeLocationStub();
    await getCoarseLocationFromGps({ LocationModule: Loc, accuracy: 'high' });
    expect(Loc.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: 4 }),
    );

    const Loc2 = makeLocationStub();
    await getCoarseLocationFromGps({ LocationModule: Loc2, accuracy: 'balanced' });
    expect(Loc2.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: 3 }),
    );
  });

  it('falls back to Low when an unknown accuracy key is given', async () => {
    const Loc = makeLocationStub();
    await getCoarseLocationFromGps({ LocationModule: Loc, accuracy: 'bogus' });
    expect(Loc.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: 1 }),
    );
  });

  it('passes timeoutMs through as timeInterval', async () => {
    const Loc = makeLocationStub();
    await getCoarseLocationFromGps({ LocationModule: Loc, timeoutMs: 5000 });
    expect(Loc.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ timeInterval: 5000 }),
    );
  });

  it('honours a custom gridM', async () => {
    const Loc = makeLocationStub({ coords: { latitude: 53.2, longitude: 6.6 } });
    const res500  = await getCoarseLocationFromGps({ LocationModule: makeLocationStub({ coords: { latitude: 53.2, longitude: 6.6 } }), gridM: 500 });
    const res1000 = await getCoarseLocationFromGps({ LocationModule: Loc, gridM: 1000 });
    expect(res500.cell).not.toBe(res1000.cell);
    expect(res500.cell).toBe(cellFor({ lat: 53.2, lng: 6.6, gridM: 500 }));
    expect(res1000.cell).toBe(cellFor({ lat: 53.2, lng: 6.6, gridM: 1000 }));
  });
});
