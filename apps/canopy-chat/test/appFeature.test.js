/**
 * S6.C (per-circle) — map an op's app to the policy.features key that gates its
 * surfaces, so a circle with tasks/calendar OFF offers no task/agenda panel.
 */
import { describe, it, expect } from 'vitest';
import { featureForApp, isAppSurfaceEnabled, APP_FEATURE } from '../src/v2/appFeature.js';
import { isFeatureEnabled, DEFAULT_CIRCLE_POLICY } from '../src/v2/circlePolicy.js';

describe('featureForApp', () => {
  it('maps the app-bundle origins to their policy.features key', () => {
    expect(featureForApp('tasks-v0')).toBe('tasks');
    expect(featureForApp('calendar')).toBe('calendar');
    expect(featureForApp('folio')).toBe('lists');
  });
  it('returns null for core/always-on apps (stoop, household, canopy-chat)', () => {
    expect(featureForApp('stoop')).toBeNull();
    expect(featureForApp('household')).toBeNull();
    expect(featureForApp('canopy-chat')).toBeNull();
    expect(featureForApp(undefined)).toBeNull();
  });
});

describe('isAppSurfaceEnabled (real circlePolicy)', () => {
  it('core apps are always enabled, whatever the policy', () => {
    expect(isAppSurfaceEnabled('stoop', { features: { tasks: false } }, isFeatureEnabled)).toBe(true);
  });
  it('tasks surfaces follow policy.features.tasks (default OFF → gated)', () => {
    // default policy has tasks:false → a fresh circle gates the task screen
    expect(isAppSurfaceEnabled('tasks-v0', DEFAULT_CIRCLE_POLICY, isFeatureEnabled)).toBe(false);
    expect(isAppSurfaceEnabled('tasks-v0', { features: { tasks: true } }, isFeatureEnabled)).toBe(true);
  });
  it('calendar surfaces follow policy.features.calendar', () => {
    expect(isAppSurfaceEnabled('calendar', { features: { calendar: true } }, isFeatureEnabled)).toBe(true);
    expect(isAppSurfaceEnabled('calendar', { features: { calendar: false } }, isFeatureEnabled)).toBe(false);
  });
  it('covers exactly the app-bundle origins', () => {
    expect(Object.keys(APP_FEATURE).sort()).toEqual(['calendar', 'folio', 'tasks', 'tasks-v0']);
  });
});
