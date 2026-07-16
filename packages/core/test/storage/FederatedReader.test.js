// @onderling/core — FederatedReader unit tests
import { describe, it, expect, vi } from 'vitest';
import { FederatedReader, FederatedReadError } from '../../src/storage/FederatedReader.js';
import { lastWriteWins, setUnionWithDedupe } from '../../src/storage/MergeContracts/index.js';

// ─── helpers ───────────────────────────────────────────────────────────────

/** Wrap a successful read result into a stub PodClient entry. */
function stubPod (sourceId, readResult) {
  return {
    sourceId,
    client: { read: vi.fn(async () => readResult) },
  };
}

/** A pod whose `read(path)` rejects with an error (optionally tagged). */
function failingPod (sourceId, errCode = 'BOOM') {
  return {
    sourceId,
    client: {
      read: vi.fn(async () => {
        const err = new Error(`pod ${sourceId} failed`);
        err.code = errCode;
        throw err;
      }),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//   Constructor validation
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — constructor validation', () => {
  it('throws if `pods` is not an array', () => {
    expect(() => new FederatedReader({ pods: null, mergeContract: lastWriteWins })).toThrow(
      /pods.*must be an array/
    );
  });

  it('throws if a pod entry is missing `client.read`', () => {
    expect(
      () =>
        new FederatedReader({
          pods: [{ sourceId: 'x', client: {} }],
          mergeContract: lastWriteWins,
        })
    ).toThrow(/client\.read/);
  });

  it('throws if a pod entry is missing a string `sourceId`', () => {
    expect(
      () =>
        new FederatedReader({
          pods: [{ client: { read: async () => ({}) } }],
          mergeContract: lastWriteWins,
        })
    ).toThrow(/sourceId/);
  });

  it('throws if `mergeContract` is not a function', () => {
    expect(() => new FederatedReader({ pods: [], mergeContract: 'nope' })).toThrow(
      /mergeContract.*function/
    );
  });

  it('throws on an unknown failurePolicy', () => {
    expect(
      () => new FederatedReader({ pods: [], mergeContract: lastWriteWins, failurePolicy: 'bogus' })
    ).toThrow(/invalid failurePolicy/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Successful reads
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — all pods succeed', () => {
  it('merges via lastWriteWins, returns highest-timestamp value, no failures', async () => {
    const pods = [
      stubPod('pod-a', { content: { name: 'old' }, lastModified: '2025-01-01T00:00:00Z' }),
      stubPod('pod-b', { content: { name: 'new' }, lastModified: '2026-01-01T00:00:00Z' }),
      stubPod('pod-c', { content: { name: 'mid' }, lastModified: '2025-06-01T00:00:00Z' }),
    ];
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    const out = await reader.read('/profile.json');
    expect(out.merged).toEqual({ name: 'new' });
    expect(out.failures).toEqual([]);
    for (const p of pods) {
      expect(p.client.read).toHaveBeenCalledWith('/profile.json');
      expect(p.client.read).toHaveBeenCalledTimes(1);
    }
  });

  it('single pod single success → merged is that pod\'s content', async () => {
    const pods = [stubPod('pod-only', { content: 42, lastModified: '2026-01-01T00:00:00Z' })];
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    const out = await reader.read('/answer');
    expect(out.merged).toBe(42);
    expect(out.failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Empty pods array
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — empty pods', () => {
  it('returns { merged: undefined, failures: [] } regardless of policy', async () => {
    const reader = new FederatedReader({ pods: [], mergeContract: lastWriteWins });

    expect(await reader.read('/anything')).toEqual({ merged: undefined, failures: [] });
    expect(await reader.read('/anything', { failurePolicy: 'fail-on-any' })).toEqual({
      merged: undefined,
      failures: [],
    });
    expect(await reader.read('/anything', { failurePolicy: 'best-effort' })).toEqual({
      merged: undefined,
      failures: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Failure mode: partial-success-with-flag (default)
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — partial-success-with-flag (default)', () => {
  it('some fail → merged from successes, failures list populated with { sourceId, error }', async () => {
    const pods = [
      stubPod('pod-a', { content: 'x', lastModified: '2026-04-01T00:00:00Z' }),
      failingPod('pod-b', 'NET'),
      stubPod('pod-c', { content: 'y', lastModified: '2026-04-15T00:00:00Z' }),
    ];
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    const out = await reader.read('/k');
    expect(out.merged).toBe('y');
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].sourceId).toBe('pod-b');
    expect(out.failures[0].error).toBeInstanceOf(Error);
    expect(out.failures[0].error.code).toBe('NET');
  });

  it('all fail → { merged: undefined, failures: [...] } (no throw)', async () => {
    const pods = [failingPod('pod-a'), failingPod('pod-b')];
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    const out = await reader.read('/k');
    expect(out.merged).toBeUndefined();
    expect(out.failures.map((f) => f.sourceId).sort()).toEqual(['pod-a', 'pod-b']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Failure mode: fail-on-any
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — fail-on-any', () => {
  it('some fail → throws FederatedReadError with all failures + successes', async () => {
    const pods = [
      stubPod('pod-a', { content: 'x', lastModified: '2026-04-01T00:00:00Z' }),
      failingPod('pod-b', 'NET'),
    ];
    const reader = new FederatedReader({
      pods,
      mergeContract: lastWriteWins,
      failurePolicy: 'fail-on-any',
    });

    await expect(reader.read('/k')).rejects.toMatchObject({
      name: 'FederatedReadError',
      code: 'FEDERATED_READ_FAIL_ON_ANY',
    });

    try {
      await reader.read('/k');
    } catch (err) {
      expect(err).toBeInstanceOf(FederatedReadError);
      expect(err.failures).toHaveLength(1);
      expect(err.failures[0].sourceId).toBe('pod-b');
      expect(err.successes).toHaveLength(1);
      expect(err.successes[0].sourceId).toBe('pod-a');
    }
  });

  it('all fail → throws FederatedReadError', async () => {
    const pods = [failingPod('pod-a'), failingPod('pod-b')];
    const reader = new FederatedReader({
      pods,
      mergeContract: lastWriteWins,
      failurePolicy: 'fail-on-any',
    });
    await expect(reader.read('/k')).rejects.toBeInstanceOf(FederatedReadError);
  });

  it('all succeed → does not throw, returns merged result', async () => {
    const pods = [
      stubPod('pod-a', { content: 'x', lastModified: '2026-01-01T00:00:00Z' }),
      stubPod('pod-b', { content: 'y', lastModified: '2026-02-01T00:00:00Z' }),
    ];
    const reader = new FederatedReader({
      pods,
      mergeContract: lastWriteWins,
      failurePolicy: 'fail-on-any',
    });
    const out = await reader.read('/k');
    expect(out.merged).toBe('y');
    expect(out.failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Failure mode: best-effort
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — best-effort', () => {
  it('all fail → returns { merged: undefined, failures: [...] } without throwing', async () => {
    const pods = [failingPod('pod-a'), failingPod('pod-b')];
    const reader = new FederatedReader({
      pods,
      mergeContract: lastWriteWins,
      failurePolicy: 'best-effort',
    });

    const out = await reader.read('/k');
    expect(out.merged).toBeUndefined();
    expect(out.failures).toHaveLength(2);
  });

  it('some fail → returns merged from successes; failures still listed for observability', async () => {
    const pods = [
      stubPod('pod-a', { content: 'x', lastModified: '2026-04-01T00:00:00Z' }),
      failingPod('pod-b'),
    ];
    const reader = new FederatedReader({
      pods,
      mergeContract: lastWriteWins,
      failurePolicy: 'best-effort',
    });

    const out = await reader.read('/k');
    expect(out.merged).toBe('x');
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].sourceId).toBe('pod-b');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Per-call failurePolicy override
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — per-call failurePolicy override', () => {
  it('overrides the constructor default for a single read', async () => {
    const pods = [
      stubPod('pod-a', { content: 'x', lastModified: '2026-04-01T00:00:00Z' }),
      failingPod('pod-b'),
    ];
    // Default is partial-success-with-flag.
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    // Per-call override → fail-on-any.
    await expect(reader.read('/k', { failurePolicy: 'fail-on-any' })).rejects.toBeInstanceOf(
      FederatedReadError
    );

    // Constructor default still applies on the next call.
    const out = await reader.read('/k');
    expect(out.merged).toBe('x');
    expect(out.failures).toHaveLength(1);
  });

  it('rejects an invalid per-call failurePolicy', async () => {
    const reader = new FederatedReader({
      pods: [stubPod('pod-a', { content: 'x', lastModified: '2026-04-01T00:00:00Z' })],
      mergeContract: lastWriteWins,
    });
    await expect(reader.read('/k', { failurePolicy: 'bogus' })).rejects.toThrow(
      /invalid failurePolicy/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Merge contract receives the right shape
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — merge contract input shape', () => {
  it('passes versions of shape { value, timestamp, sourceId } to the contract', async () => {
    const spy = vi.fn(() => 'merged-sentinel');
    const pods = [
      stubPod('pod-a', { content: { name: 'a' }, lastModified: '2026-01-01T00:00:00Z' }),
      stubPod('pod-b', { content: { name: 'b' }, lastModified: '2026-02-01T00:00:00Z' }),
    ];
    const reader = new FederatedReader({ pods, mergeContract: spy });

    const out = await reader.read('/k');
    expect(out.merged).toBe('merged-sentinel');
    expect(spy).toHaveBeenCalledTimes(1);

    const versions = spy.mock.calls[0][0];
    expect(versions).toHaveLength(2);
    for (const ver of versions) {
      expect(ver).toHaveProperty('value');
      expect(ver).toHaveProperty('timestamp');
      expect(ver).toHaveProperty('sourceId');
      expect(typeof ver.timestamp).toBe('number');
      expect(Number.isFinite(ver.timestamp)).toBe(true);
    }
    const bySource = Object.fromEntries(versions.map((v) => [v.sourceId, v]));
    expect(bySource['pod-a'].value).toEqual({ name: 'a' });
    expect(bySource['pod-b'].value).toEqual({ name: 'b' });
    expect(bySource['pod-a'].timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(bySource['pod-b'].timestamp).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('forwards `mergeOpts` as the second argument to the contract', async () => {
    const spy = vi.fn((versions, opts) => ({ versions, opts }));
    const pods = [stubPod('pod-a', { content: [1, 2], lastModified: '2026-01-01T00:00:00Z' })];
    const reader = new FederatedReader({ pods, mergeContract: spy });

    const passOpts = { itemHash: (x) => String(x) };
    await reader.read('/k', { mergeOpts: passOpts });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(passOpts);
  });

  it('falls back to Date.now() when lastModified is unparseable (does not throw)', async () => {
    const spy = vi.fn(() => 'ok');
    const pods = [stubPod('pod-a', { content: 'x', lastModified: 'not-a-date' })];
    const reader = new FederatedReader({ pods, mergeContract: spy });

    const before = Date.now();
    await reader.read('/k');
    const after = Date.now();

    const ts = spy.mock.calls[0][0][0].timestamp;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('integrates with setUnionWithDedupe end-to-end', async () => {
    const pods = [
      stubPod('pod-a', {
        content: [{ id: 1 }, { id: 2 }],
        lastModified: '2026-01-01T00:00:00Z',
      }),
      stubPod('pod-b', {
        content: [{ id: 2 }, { id: 3 }],
        lastModified: '2026-02-01T00:00:00Z',
      }),
    ];
    const reader = new FederatedReader({ pods, mergeContract: setUnionWithDedupe });
    const out = await reader.read('/items', {
      mergeOpts: { itemHash: (x) => String(x.id) },
    });
    expect(out.merged.map((x) => x.id).sort()).toEqual([1, 2, 3]);
    expect(out.failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   Concurrent reads
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — concurrent reads do not interfere', () => {
  it('two simultaneous read() calls each see their own results', async () => {
    // Each pod returns a path-dependent payload so we can prove no
    // cross-talk between concurrent invocations.
    const makePod = (sourceId) => ({
      sourceId,
      client: {
        read: vi.fn(async (path) => ({
          content: `${sourceId}:${path}`,
          lastModified: '2026-01-01T00:00:00Z',
        })),
      },
    });
    const pods = [makePod('pod-a'), makePod('pod-b')];
    const reader = new FederatedReader({ pods, mergeContract: lastWriteWins });

    const [out1, out2] = await Promise.all([reader.read('/x'), reader.read('/y')]);

    // lastWriteWins on identical timestamps picks the lexicographically
    // larger sourceId → pod-b for both calls, but the path differs.
    expect(out1.merged).toBe('pod-b:/x');
    expect(out2.merged).toBe('pod-b:/y');
    expect(out1.failures).toEqual([]);
    expect(out2.failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//   parseTimestamp tolerates Date instances + numeric input
// ═══════════════════════════════════════════════════════════════════════════

describe('FederatedReader — lastModified shape tolerance', () => {
  it('accepts Date instances', async () => {
    const spy = vi.fn(() => 'ok');
    const date = new Date('2026-03-01T00:00:00Z');
    const pods = [stubPod('pod-a', { content: 'x', lastModified: date })];
    const reader = new FederatedReader({ pods, mergeContract: spy });
    await reader.read('/k');
    expect(spy.mock.calls[0][0][0].timestamp).toBe(date.getTime());
  });

  it('accepts numeric unix-ms', async () => {
    const spy = vi.fn(() => 'ok');
    const pods = [stubPod('pod-a', { content: 'x', lastModified: 1717200000000 })];
    const reader = new FederatedReader({ pods, mergeContract: spy });
    await reader.read('/k');
    expect(spy.mock.calls[0][0][0].timestamp).toBe(1717200000000);
  });
});
