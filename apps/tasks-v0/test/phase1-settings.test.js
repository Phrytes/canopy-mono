/**
 * Phase 1 smoke tests — Tasks-bound Settings module.
 *
 * Proves the `@canopy/local-store` `createSettingsModule` factory,
 * bound to Tasks V1's field schema, behaves correctly:
 *   - returns defaults when no settings file exists yet
 *   - round-trips a write
 *   - validates `pollIntervalMs` against the floor (100ms)
 *   - keeps shared and device fields on separate paths
 */

import { describe, it, expect } from 'vitest';

import { CachingDataSource } from '@canopy/local-store';
import {
  loadSettings,
  saveSettings,
  updateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SHARED_PATH,
  SETTINGS_DEVICE_PATH_PREFIX,
} from '../src/storage/settings.js';

const DEVICE_ID = 'test-device-001';

function freshDS() {
  return new CachingDataSource({
    localOnlyPrefixes: [], // tests don't care about pod-skip rules
  });
}

describe('Phase 1 — Tasks Settings', () => {
  it('returns documented defaults on a cold-boot read', async () => {
    const ds = freshDS();
    const s = await loadSettings({ dataSource: ds, deviceId: DEVICE_ID });
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.pollIntervalMs).toBe(15_000);
    expect(s.defaultCalendarShared).toBe(false);
  });

  it('round-trips a saveSettings → loadSettings cycle for a shared field', async () => {
    const ds = freshDS();
    await saveSettings({
      dataSource: ds,
      deviceId:   DEVICE_ID,
      settings:   { ...DEFAULT_SETTINGS, defaultCalendarShared: true },
    });
    const s = await loadSettings({ dataSource: ds, deviceId: DEVICE_ID });
    expect(s.defaultCalendarShared).toBe(true);
  });

  it('round-trips a saveSettings → loadSettings cycle for a device field', async () => {
    const ds = freshDS();
    await saveSettings({
      dataSource: ds,
      deviceId:   DEVICE_ID,
      settings:   { ...DEFAULT_SETTINGS, pollIntervalMs: 5000 },
    });
    const s = await loadSettings({ dataSource: ds, deviceId: DEVICE_ID });
    expect(s.pollIntervalMs).toBe(5000);
  });

  it('rejects pollIntervalMs values below the 100ms floor (validator falls back to default)', async () => {
    const ds = freshDS();
    await saveSettings({
      dataSource: ds,
      deviceId:   DEVICE_ID,
      settings:   { ...DEFAULT_SETTINGS, pollIntervalMs: 10 },
    });
    const s = await loadSettings({ dataSource: ds, deviceId: DEVICE_ID });
    expect(s.pollIntervalMs).toBe(15_000);
  });

  it('updateSettings patches without overwriting unrelated fields', async () => {
    const ds = freshDS();
    await updateSettings({
      dataSource: ds,
      deviceId:   DEVICE_ID,
      patch:      { pollIntervalMs: 8000 },
    });
    await updateSettings({
      dataSource: ds,
      deviceId:   DEVICE_ID,
      patch:      { defaultCalendarShared: true },
    });
    const s = await loadSettings({ dataSource: ds, deviceId: DEVICE_ID });
    expect(s.pollIntervalMs).toBe(8000);
    expect(s.defaultCalendarShared).toBe(true);
  });

  it('paths are namespaced under the `tasks` appId', () => {
    expect(SETTINGS_SHARED_PATH).toBe('mem://tasks/settings/shared.json');
    expect(SETTINGS_DEVICE_PATH_PREFIX).toBe('mem://tasks/settings/devices/');
  });
});
