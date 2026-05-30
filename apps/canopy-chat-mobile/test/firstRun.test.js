/**
 * 5.9b — first-run welcome probe.
 *
 * Map-backed AsyncStorage stub keeps the test pure (no RN runtime,
 * no actual AsyncStorage import).  We cover every branch of the
 * decision tree the App.js gate consults.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldShowFirstRunWelcome, markWelcomeDismissed, clearWelcomeMarker,
  FIRST_RUN_STORAGE_KEYS,
} from '../src/core/firstRun.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem:    async (k) => (map.has(k) ? map.get(k) : null),
    setItem:    async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
}

describe('shouldShowFirstRunWelcome', () => {
  it('returns true when storage is empty (real first run)', async () => {
    expect(await shouldShowFirstRunWelcome(makeStorage({}))).toBe(true);
  });

  it('returns false when the welcomed flag is set (returning user)', async () => {
    const s = makeStorage({ [FIRST_RUN_STORAGE_KEYS.welcomed]: '1' });
    expect(await shouldShowFirstRunWelcome(s)).toBe(false);
  });

  it("returns false when the chat identity exists (vault has been populated)", async () => {
    const s = makeStorage({ [FIRST_RUN_STORAGE_KEYS.chatIdentity]: 'somekey' });
    expect(await shouldShowFirstRunWelcome(s)).toBe(false);
  });

  it('treats a thrown getItem as "show welcome" (fail-open)', async () => {
    const broken = { getItem: async () => { throw new Error('storage down'); } };
    expect(await shouldShowFirstRunWelcome(broken)).toBe(true);
  });

  it('returns true when given a falsy asyncStorage (defensive default)', async () => {
    expect(await shouldShowFirstRunWelcome(null)).toBe(true);
    expect(await shouldShowFirstRunWelcome(undefined)).toBe(true);
    expect(await shouldShowFirstRunWelcome({})).toBe(true);
  });
});

describe('markWelcomeDismissed / clearWelcomeMarker', () => {
  it('round-trips: mark → probe returns false → clear → probe returns true again', async () => {
    const s = makeStorage({});
    expect(await shouldShowFirstRunWelcome(s)).toBe(true);
    await markWelcomeDismissed(s);
    expect(s.map.get(FIRST_RUN_STORAGE_KEYS.welcomed)).toBe('1');
    expect(await shouldShowFirstRunWelcome(s)).toBe(false);
    await clearWelcomeMarker(s);
    expect(await shouldShowFirstRunWelcome(s)).toBe(true);
  });

  it('mark / clear are no-ops on a falsy asyncStorage', async () => {
    await expect(markWelcomeDismissed(null)).resolves.toBeUndefined();
    await expect(clearWelcomeMarker(null)).resolves.toBeUndefined();
  });

  it('a throwing setItem does not propagate (best-effort)', async () => {
    const broken = { setItem: async () => { throw new Error('disk full'); } };
    await expect(markWelcomeDismissed(broken)).resolves.toBeUndefined();
  });
});
