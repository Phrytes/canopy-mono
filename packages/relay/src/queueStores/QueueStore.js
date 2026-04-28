/**
 * QueueStore — durable storage for in-flight multi-recipient requests.
 *
 * @abstract
 *
 * Each in-flight "request" is an aggregate operation: caller sent a request
 * targeted at N matching subscribers, and we're waiting for their fan-in
 * responses (or a timeout).
 *
 * Implementations: MemoryQueueStore (tests), SqliteQueueStore (production v1),
 * RedisQueueStore (future, multi-process).
 *
 * Request shape (what implementations should round-trip):
 *   {
 *     id:                 string,
 *     callerPubKey:       string,
 *     targets:            string[],
 *     expectedResponses:  number,
 *     deadline:           number,         // unix-ms
 *     payload:            object|Buffer,
 *     createdAt:          number,         // unix-ms
 *     responses:          [{ fromPubKey, response, at }],
 *     closed:             boolean,
 *   }
 *
 * See `coding-plans/track-E-mobile-push-relay.md` §E2b.
 */
export class QueueStore {
  /**
   * Persist a new in-flight request.
   * @param {object} req — { id, callerPubKey, targets, expectedResponses, deadline, payload, createdAt }
   * @returns {Promise<object>} the persisted request (with empty responses + closed=false)
   */
  async putRequest(req) { throw new Error('QueueStore.putRequest() not implemented'); }

  /**
   * Look up a request by id.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getRequest(id) { throw new Error('QueueStore.getRequest() not implemented'); }

  /** All non-expired open requests, e.g. for restart recovery. */
  async listOpen() { throw new Error('QueueStore.listOpen() not implemented'); }

  /**
   * Record a fan-in response.  Returns the updated request (with collected
   * responses), or null if the request id is unknown / closed.
   * @param {string} id
   * @param {string} fromPubKey
   * @param {*}      response
   * @returns {Promise<object|null>}
   */
  async addResponse(id, fromPubKey, response) {
    throw new Error('QueueStore.addResponse() not implemented');
  }

  /** Mark a request closed (responses gathered or deadline passed).  Idempotent. */
  async closeRequest(id) { throw new Error('QueueStore.closeRequest() not implemented'); }

  /** Hard delete (for cleanup). */
  async delete(id) { throw new Error('QueueStore.delete() not implemented'); }

  /** Idempotent close hook. */
  async close() { /* no-op by default */ }
}
