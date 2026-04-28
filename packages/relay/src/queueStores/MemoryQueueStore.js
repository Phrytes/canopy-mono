/**
 * MemoryQueueStore — in-process implementation of `QueueStore`.
 *
 * Shipped for tests so unit tests don't need an on-disk SQLite file.
 * Not durable across restarts; for that, use `SqliteQueueStore`.
 *
 * See `coding-plans/track-E-mobile-push-relay.md` §E2b.
 */
import { QueueStore } from './QueueStore.js';

export class MemoryQueueStore extends QueueStore {
  #requests = new Map();

  async putRequest(req) {
    const stored = { ...req, responses: [], closed: false };
    this.#requests.set(req.id, stored);
    return stored;
  }

  async getRequest(id) {
    return this.#requests.get(id) ?? null;
  }

  async listOpen() {
    const now = Date.now();
    return [...this.#requests.values()].filter(r => !r.closed && r.deadline > now);
  }

  async addResponse(id, fromPubKey, response) {
    const req = this.#requests.get(id);
    if (!req || req.closed) return null;
    req.responses.push({ fromPubKey, response, at: Date.now() });
    return req;
  }

  async closeRequest(id) {
    const r = this.#requests.get(id);
    if (r) r.closed = true;
  }

  async delete(id) {
    this.#requests.delete(id);
  }

  async close() {
    this.#requests.clear();
  }
}
