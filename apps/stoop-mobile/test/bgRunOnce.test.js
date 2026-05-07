/**
 * bgRunOnce (stoop-mobile) — verifies the substrate re-export wiring
 * and the stoop-specific task name.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setBgRunOnce,
  clearBgRunOnce,
  bgRunOnce,
  BG_TASK_NAME,
} from '../src/lib/bgRunOnce.js';

describe('bgRunOnce — Stoop wiring', () => {
  beforeEach(() => {
    clearBgRunOnce();
  });

  it('exposes a stoop-specific BG_TASK_NAME', () => {
    expect(BG_TASK_NAME).toBe('stoop-mobile-sync-background');
  });

  it('returns null before setBgRunOnce is called', async () => {
    expect(await bgRunOnce()).toBeNull();
  });

  it('routes to the registered runner once set', async () => {
    setBgRunOnce(async () => ({ uploads: 1, downloads: 2, deletes: 0 }));
    const r = await bgRunOnce();
    expect(r).toEqual({ uploads: 1, downloads: 2, deletes: 0 });
  });

  it('falls back to null after clearBgRunOnce', async () => {
    setBgRunOnce(async () => ({ uploads: 0 }));
    clearBgRunOnce();
    expect(await bgRunOnce()).toBeNull();
  });
});
