/**
 * withCAS — etag-based retry helper.
 */

import { describe, it, expect } from 'vitest';
import { withCAS } from '../src/concurrency.js';

describe('withCAS — happy path', () => {
  it('reads, mutates, writes once when no conflict', async () => {
    let writes = 0;
    const r = await withCAS({
      readCurrent: async () => ({ body: { v: 1, agents: [] }, etag: '"e0"' }),
      mutate:      (body)   => ({ ...body, agents: ['x'] }),
      writeNext:   async () => { writes++; return { etag: '"e1"' }; },
    });
    expect(r.body.agents).toEqual(['x']);
    expect(r.etag).toBe('"e1"');
    expect(r.retries).toBe(0);
    expect(writes).toBe(1);
  });
});

describe('withCAS — conflict + retry', () => {
  it('retries on CONFLICT up to maxRetries; succeeds after a transient conflict', async () => {
    let writeAttempts = 0;
    const r = await withCAS({
      readCurrent: async () => ({ body: { agents: [] }, etag: '"e0"' }),
      mutate:      (body)   => ({ ...body, agents: ['ok'] }),
      writeNext:   async () => {
        writeAttempts++;
        if (writeAttempts === 1) {
          throw Object.assign(new Error('etag mismatch'), { code: 'CONFLICT' });
        }
        return { etag: '"e2"' };
      },
      sleep: async () => {},   // no real delay in tests
    });
    expect(r.retries).toBe(1);
    expect(writeAttempts).toBe(2);
  });

  it('exhausts retries → throws PERSISTENT_CONFLICT + fires callback', async () => {
    let cbFired = 0;
    await expect(withCAS({
      readCurrent: async () => ({ body: { agents: [] }, etag: '"e0"' }),
      mutate:      (body)   => ({ ...body }),
      writeNext:   async () => { throw Object.assign(new Error('412'), { code: 'CONFLICT' }); },
      maxRetries:  2,
      sleep:       async () => {},
      onPersistentConflict: () => { cbFired++; },
    })).rejects.toMatchObject({ code: 'PERSISTENT_CONFLICT' });
    expect(cbFired).toBe(1);
  });

  it('non-CONFLICT errors propagate immediately', async () => {
    await expect(withCAS({
      readCurrent: async () => ({ body: {}, etag: null }),
      mutate:      (body)   => body,
      writeNext:   async () => { throw Object.assign(new Error('boom'), { code: 'NETWORK_ERROR' }); },
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('mutation throw propagates', async () => {
    await expect(withCAS({
      readCurrent: async () => ({ body: {}, etag: null }),
      mutate:      ()       => { throw new Error('reject'); },
      writeNext:   async () => ({ etag: 'unused' }),
    })).rejects.toThrow('reject');
  });
});

describe('withCAS — input validation', () => {
  it('throws when missing required args', async () => {
    await expect(withCAS({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
