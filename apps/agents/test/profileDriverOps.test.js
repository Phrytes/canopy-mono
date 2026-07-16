// Drivers #3 — the setProfileDriver / getProfileDrivers agent ops. Drivers are OPEN { kind, text,
// tags[] } values (not the coarse string setProfileProperty takes), so they get their own op that
// builds+validates via the injected `profiles` collaborator. Here we drive the cores with a fake
// collaborator backed by the REAL createDriver/driversFromProperties, so arg-handling + degrade +
// invalid-driver are all exercised.
import { describe, it, expect } from 'vitest';
import { createDriver, driversFromProperties } from '@onderling/agent-registry';
import { setProfileDriver, getProfileDrivers } from '../src/cores.js';

// A minimal profiles collaborator mirroring realAgent's setDriver/getDrivers over an in-memory map.
function fakeStore() {
  const properties = { place: 'Groningen' };   // a non-driver property, to prove filtering
  return {
    registry: { list: async () => [] },
    profiles: {
      setDriver: async ({ key, kind, text, tags }) => { properties[key] = createDriver({ kind, text, tags }); return { ok: true }; },
      getDrivers: async () => driversFromProperties(properties),
    },
    _properties: properties,
  };
}

describe('setProfileDriver / getProfileDrivers (#3)', () => {
  it('sets a driver from an object arg and reads it back (filtering out non-drivers)', async () => {
    const store = fakeStore();
    const r = await setProfileDriver(store, { id: 'default', key: 'goals', kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] });
    expect(r).toEqual({ ok: true, id: 'default', key: 'goals' });
    expect(store._properties.goals).toEqual({ kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] });

    const got = await getProfileDrivers(store, { id: 'default' });
    expect(got.ok).toBe(true);
    expect(Object.keys(got.drivers)).toEqual(['goals']);   // place (coarse-enum) filtered out
    expect(got.drivers.goals.tags).toEqual(['sailing', 'learning']);
  });

  it('accepts tags as a comma-separated string (wire/slash path)', async () => {
    const store = fakeStore();
    await setProfileDriver(store, { id: 'default', key: 'hobby', text: 'board games', tags: 'boardgames, social ,social' });
    expect(store._properties.hobby.tags).toEqual(['boardgames', 'social']);   // split, normalised, de-duped
    expect(store._properties.hobby.kind).toBe('driver');                       // default kind
  });

  it('an empty driver (no text, no tags) → ok:false invalid-driver (never persisted)', async () => {
    const store = fakeStore();
    const r = await setProfileDriver(store, { id: 'default', key: 'empty', tags: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-driver');
    expect(store._properties.empty).toBeUndefined();
  });

  it('guards required args + degrades when the collaborator is unwired', async () => {
    const store = fakeStore();
    expect((await setProfileDriver(store, { key: 'x', text: 'y' })).reason).toBe('id-required');
    expect((await setProfileDriver(store, { id: 'default', text: 'y' })).reason).toBe('key-required');
    const unwired = { registry: { list: async () => [] }, profiles: {} };
    expect((await setProfileDriver(unwired, { id: 'd', key: 'k', text: 'y' })).reason).toBe('profiles-unavailable');
    expect((await getProfileDrivers(unwired, { id: 'd' })).reason).toBe('profiles-unavailable');
  });
});
