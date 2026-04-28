// @canopy/core — storage/FederatedReader
//
// Pure-orchestration class that reads the same path across N member
// pods in parallel, then merges the results through a D4 merge
// contract.  Powers the "hybrid pod pattern" where each member keeps
// their own pod and a federated read produces a merged view.
//
// FederatedReader has no transport stack of its own — it just composes
// N "PodClient-like" objects with a merge contract.
//
// Minimum PodClient interface consumed:
//   {
//     read(uri): Promise<{
//       content,
//       lastModified,    // ISO date string or Date — used as merge timestamp
//       etag?, contentType?, size?,
//     }>
//   }
//
// This is satisfied by Track-A5's `@canopy/pod-client` `PodClient`
// AND by simple in-memory test mocks.
//
// Per Q-D.3 (locked 2026-04-28): default failure-mode policy is
// `partial-success-with-flag` — `read()` returns
// `{ merged, failures: [{ sourceId, error }] }`.  Per-call override
// via `failurePolicy` opt to `'fail-on-any'` or `'best-effort'`.

const VALID_POLICIES = new Set(['partial-success-with-flag', 'fail-on-any', 'best-effort']);

/**
 * Aggregate error thrown when `failurePolicy: 'fail-on-any'` is in
 * effect and at least one pod read failed.  Preserves both the list
 * of failures and any successes for debugging.
 */
export class FederatedReadError extends Error {
  constructor (message, { failures, successes } = {}) {
    super(message);
    this.name = 'FederatedReadError';
    this.code = 'FEDERATED_READ_FAIL_ON_ANY';
    this.failures = failures ?? [];
    this.successes = successes ?? [];
  }
}

/**
 * Parse a `lastModified` value into a unix-ms timestamp suitable for
 * merge contracts that order versions by time.  Accepts:
 *   - `Date` instance
 *   - ISO date string (or anything `Date.parse` understands)
 *   - already-numeric unix-ms
 * Falls back to `Date.now()` when unparseable — the merge contract
 * may then tie-break on `sourceId`.  Worst-case behavior; documented.
 *
 * @param {*} lastModified
 * @returns {number} unix-ms
 */
function parseTimestamp (lastModified) {
  if (lastModified == null) return Date.now();
  if (lastModified instanceof Date) {
    const t = lastModified.getTime();
    return Number.isFinite(t) ? t : Date.now();
  }
  if (typeof lastModified === 'number' && Number.isFinite(lastModified)) {
    return lastModified;
  }
  if (typeof lastModified === 'string') {
    const t = Date.parse(lastModified);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

export class FederatedReader {
  /**
   * @param {object}   config
   * @param {Array<{ client: { read(path): Promise<object> }, sourceId: string }>} config.pods
   *   Each entry pairs a PodClient-like object with a stable identifier.
   *   `sourceId` is required (the merge contract receives it on every
   *   version) — not every PodClient exposes a clean identifier so we
   *   take it explicitly.
   * @param {(versions: Array<{value, timestamp, sourceId}>, opts?: object) => *} config.mergeContract
   *   A pure function from D4's MergeContracts (e.g. `setUnionWithDedupe`,
   *   `appendOnlyEventLog`, `lastWriteWins`).
   * @param {'partial-success-with-flag' | 'fail-on-any' | 'best-effort'} [config.failurePolicy]
   *   Default failure-mode policy.  Override per-call via `read(path, { failurePolicy })`.
   *   Defaults to `'partial-success-with-flag'` (Q-D.3).
   */
  constructor ({ pods, mergeContract, failurePolicy = 'partial-success-with-flag' } = {}) {
    if (!Array.isArray(pods)) {
      throw new TypeError('FederatedReader: `pods` must be an array');
    }
    for (const entry of pods) {
      if (!entry || typeof entry !== 'object') {
        throw new TypeError('FederatedReader: each pod entry must be an object { client, sourceId }');
      }
      if (!entry.client || typeof entry.client.read !== 'function') {
        throw new TypeError('FederatedReader: each pod entry must have a `client.read(path)` function');
      }
      if (typeof entry.sourceId !== 'string' || entry.sourceId.length === 0) {
        throw new TypeError('FederatedReader: each pod entry must have a non-empty string `sourceId`');
      }
    }
    if (typeof mergeContract !== 'function') {
      throw new TypeError('FederatedReader: `mergeContract` must be a function');
    }
    if (!VALID_POLICIES.has(failurePolicy)) {
      throw new TypeError(`FederatedReader: invalid failurePolicy "${failurePolicy}"`);
    }

    // Constructor fields are immutable (no shared mutable state) so
    // concurrent `read()` calls don't interfere with each other.
    this._pods = pods.slice();
    this._mergeContract = mergeContract;
    this._failurePolicy = failurePolicy;
  }

  /**
   * Read `path` from every pod in parallel, then merge the results.
   *
   * @param {string} path
   * @param {object} [opts]
   * @param {'partial-success-with-flag' | 'fail-on-any' | 'best-effort'} [opts.failurePolicy]
   *   Per-call override of the constructor default.
   * @param {object} [opts.mergeOpts]
   *   Forwarded as the second argument to the merge contract.
   * @returns {Promise<{ merged: *, failures: Array<{ sourceId: string, error: Error }> }>}
   *   On `'fail-on-any'`, throws `FederatedReadError` instead.
   */
  async read (path, opts = {}) {
    const policy = opts.failurePolicy ?? this._failurePolicy;
    if (!VALID_POLICIES.has(policy)) {
      throw new TypeError(`FederatedReader.read: invalid failurePolicy "${policy}"`);
    }
    const mergeOpts = opts.mergeOpts;

    // Empty pods array → trivially nothing to read.  Return a stable
    // shape regardless of policy (no successes and no failures means
    // nothing can throw on `'fail-on-any'`).
    if (this._pods.length === 0) {
      return { merged: undefined, failures: [] };
    }

    // Parallel-fetch.  `Promise.allSettled` never rejects, so a single
    // failing pod never aborts the others.
    const settled = await Promise.allSettled(
      this._pods.map((entry) => entry.client.read(path))
    );

    const successes = [];
    const failures = [];
    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      const { sourceId } = this._pods[i];
      if (result.status === 'fulfilled') {
        successes.push({ sourceId, value: result.value });
      } else {
        failures.push({ sourceId, error: result.reason });
      }
    }

    if (policy === 'fail-on-any' && failures.length > 0) {
      throw new FederatedReadError(
        `FederatedReader: ${failures.length} of ${this._pods.length} pod(s) failed (failurePolicy=fail-on-any)`,
        { failures, successes }
      );
    }

    // 'best-effort' silently ignores failures.  We still include the
    // failures list in the returned shape for observability — it's
    // cheap and harmless, and lets callers log/debug if they want to.
    // 'partial-success-with-flag' (default) is identical in shape;
    // the difference is purely whether the policy *promised* to flag.

    if (successes.length === 0) {
      // No pods succeeded.  Both 'partial-success-with-flag' and
      // 'best-effort' return undefined merged + the failures list.
      return { merged: undefined, failures };
    }

    const versions = successes.map(({ sourceId, value }) => ({
      value: value?.content,
      timestamp: parseTimestamp(value?.lastModified),
      sourceId,
    }));

    const merged = this._mergeContract(versions, mergeOpts);
    return { merged, failures };
  }
}
