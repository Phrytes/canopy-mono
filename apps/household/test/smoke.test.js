/**
 * smoke.test.js — Phase 0 sanity check.  Imports work, types
 * module loads, no runtime errors.  Each Phase 1 stream adds its
 * own tests under `test/<area>/`.
 */
import { describe, it, expect } from 'vitest';

describe('@canopy-app/household — scaffold', () => {
  it('the package builds and the entry module imports cleanly', async () => {
    const mod = await import('../src/index.js');
    expect(mod).toBeTruthy();
    expect(mod.Types).toBeTruthy();
    expect(mod.Types.__types__).toBe(true);
  });

  it('the MessagingBridge interface module loads', async () => {
    const mod = await import('../src/bridges/MessagingBridge.js');
    expect(mod.__interface__).toBe(true);
  });

  it('the Store interface module loads', async () => {
    const mod = await import('../src/storage/Store.js');
    expect(mod.__interface__).toBe(true);
  });
});
