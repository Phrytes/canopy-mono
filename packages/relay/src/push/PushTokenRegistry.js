/**
 * PushTokenRegistry — relay-side address ↔ push-token map.
 *
 * Populated by `{type: 'register-push-token'}` envelopes that connected
 * clients send after their initial `register`.  Consumed by the relay
 * when a message lands for a peer that's currently disconnected, to wake
 * the device via `PushSender`.
 *
 * V0 is purely in-memory.  Persistence is out of scope until the relay
 * stops being a single-process service.  When that day comes, swap this
 * for a `PushTokenStore` interface mirroring `QueueStore` (memory /
 * sqlite / redis) — the consumer-facing API is the same.
 */
export class PushTokenRegistry {
  /** @type {Map<string, {token: string, platform: string, registeredAt: number, lastPushedAt: number}>} */
  #byAddress = new Map();

  /**
   * Register or update a token for an address.  Re-registering replaces
   * the previous record.
   *
   * @param {string} address       peer pubKey (the relay's address space)
   * @param {object} args
   * @param {string} args.token    device push token
   * @param {string} args.platform 'ios'|'android'|'web'
   */
  register(address, { token, platform } = {}) {
    if (!address || typeof address !== 'string') {
      throw new TypeError('PushTokenRegistry.register: address required');
    }
    if (!token || typeof token !== 'string') {
      throw new TypeError('PushTokenRegistry.register: token required');
    }
    this.#byAddress.set(address, {
      token,
      platform:     platform ?? 'unknown',
      registeredAt: Date.now(),
      lastPushedAt: 0,
    });
  }

  /**
   * Idempotent removal.  Safe to call for an unknown address.
   */
  unregister(address) {
    this.#byAddress.delete(address);
  }

  /**
   * Look up a token record.  Returns null if the address has none.
   *
   * @returns {{token: string, platform: string, registeredAt: number, lastPushedAt: number}|null}
   */
  get(address) {
    return this.#byAddress.get(address) ?? null;
  }

  /**
   * Update the last-pushed timestamp.  Used by the throttler.  No-op for
   * unknown addresses.
   */
  markPushed(address, when = Date.now()) {
    const rec = this.#byAddress.get(address);
    if (!rec) return;
    rec.lastPushedAt = when;
  }

  size() { return this.#byAddress.size; }

  /** Test helper: clear all entries. */
  clear() { this.#byAddress.clear(); }
}
