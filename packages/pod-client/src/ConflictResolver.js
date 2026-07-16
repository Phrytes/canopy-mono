/**
 * ConflictResolver — payload helper for the `'conflict'` event surfaced by
 * `PodClient.write` on HTTP 412 Precondition Failed.
 *
 * @see Design-v3/pod-client-api.md §Conflict detection
 *
 * `PodClient` constructs one of these per 412, emits it via the `'conflict'`
 * event, and then awaits `resolver._wait(timeoutMs)`.  Listeners drive the
 * outcome:
 *
 *   - `event.resolveWith(content)` — re-issue the write with `force: true`
 *     and the supplied content.
 *   - `event.cancelWrite()`        — abort; PodClient throws `ConflictError`.
 *   - (no listener / listener does neither / listener throws) — the wait
 *     times out and PodClient falls through to its `conflictPolicy` default.
 *
 * The resolver is intentionally tiny: no fetch logic of its own; the caller
 * (`PodClient`) is responsible for building `remoteContent` lazily before
 * constructing the resolver (text/JSON ≤ ~1 MB) and for re-issuing the write
 * after `resolveWith`.
 */

const RESOLVE = Symbol('resolveWith');
const CANCEL  = Symbol('cancelWrite');
const TIMEOUT = Symbol('timeout');

/**
 * Payload for the `'conflict'` event that `PodClient.write` emits on HTTP 412. A listener settles
 * it by calling `resolveWith(content)` (re-issue the write with `force: true`) or `cancelWrite()`
 * (abort with `ConflictError`); if nothing settles it, `PodClient`'s wait times out and the
 * configured `conflictPolicy` applies. First settlement wins; later calls are no-ops.
 */
export class ConflictResolver {
  #deferred;
  #settled = false;

  /**
   * @param {object} init
   * @param {string} init.uri
   * @param {*}      init.localContent          — the content the caller tried to write
   * @param {*}     [init.remoteContent]        — fetched on demand by PodClient (text/JSON ≤ ~1 MB).  May be undefined for binary / oversized.
   * @param {string|null} [init.localLastModified]
   * @param {string|null} [init.remoteLastModified]
   */
  constructor({ uri, localContent, remoteContent, localLastModified, remoteLastModified } = {}) {
    this.uri                 = uri;
    this.localContent        = localContent;
    this.remoteContent       = remoteContent;
    this.localLastModified   = localLastModified  ?? null;
    this.remoteLastModified  = remoteLastModified ?? null;

    let resolveDeferred;
    let rejectDeferred;
    const promise = new Promise((res, rej) => { resolveDeferred = res; rejectDeferred = rej; });
    this.#deferred = { promise, resolve: resolveDeferred, reject: rejectDeferred };

    // Bind event-handler methods so listeners can destructure freely.
    this.resolveWith = this.resolveWith.bind(this);
    this.cancelWrite = this.cancelWrite.bind(this);
  }

  /**
   * Listener API: re-issue the write with `content`, force-overwriting the
   * remote version.
   *
   * If the listener calls this twice, only the first call wins; subsequent
   * calls are no-ops.
   *
   * @param {*} content — replacement content to write (string / Uint8Array /
   *                      ArrayBuffer / object — same shape PodClient.write
   *                      accepts).
   */
  resolveWith(content) {
    if (this.#settled) return;
    this.#settled = true;
    this.#deferred.resolve({ kind: RESOLVE, content });
  }

  /**
   * Listener API: abort the write.  PodClient will throw `ConflictError`.
   *
   * If the listener calls this twice, only the first call wins; subsequent
   * calls are no-ops.
   */
  cancelWrite() {
    if (this.#settled) return;
    this.#settled = true;
    this.#deferred.resolve({ kind: CANCEL });
  }

  /**
   * @internal — PodClient awaits this to learn the listener's decision (if
   * any).  Resolves with one of:
   *
   *   { kind: RESOLVE, content }   — listener called resolveWith
   *   { kind: CANCEL }             — listener called cancelWrite
   *   { kind: TIMEOUT }            — no listener decision within `timeoutMs`
   *
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<{kind: symbol, content?: *}>}
   */
  async _wait(timeoutMs = 30_000) {
    let timer;
    const timeout = new Promise((res) => {
      timer = setTimeout(() => {
        if (!this.#settled) {
          this.#settled = true;
          res({ kind: TIMEOUT });
        }
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.#deferred.promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** @internal — exposed for tests / instance-of checks. */
  static get RESOLVE() { return RESOLVE; }
  static get CANCEL()  { return CANCEL;  }
  static get TIMEOUT() { return TIMEOUT; }
}
