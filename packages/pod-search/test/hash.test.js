import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hash } from '../src/index.js';

/**
 * hash adapter (52.25) — the platform-wired SHA-256 PodSearch uses as its
 * content-hash cache key. Must be deterministic + byte-identical to a
 * plain node:crypto SHA-256 so an index written on one platform reloads
 * with the same cache keys on another.
 */
const nodeSha = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');

describe('hash(text) → hex SHA-256', () => {
  it('matches node:crypto SHA-256 (byte-identical, lowercase hex)', async () => {
    for (const t of ['', 'car', 'automobile repair', 'is de melk-boel nog open?', '🚗 x\n\ny']) {
      expect(await hash(t)).toBe(nodeSha(t));
    }
  });

  it('is deterministic (same text → same digest)', async () => {
    expect(await hash('recipes')).toBe(await hash('recipes'));
  });

  it('is 64 lowercase hex chars', async () => {
    const h = await hash('anything');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('coerces nullish input to the empty-string digest', async () => {
    expect(await hash(undefined)).toBe(nodeSha(''));
    expect(await hash(null)).toBe(nodeSha(''));
  });

  it('is usable as a PodSearch hash seam (distinct texts → distinct keys)', async () => {
    expect(await hash('a')).not.toBe(await hash('b'));
  });
});
