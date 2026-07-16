/**
 * HubDelegateTransport — Transport implementation that delegates wire I/O
 * to a Hub binder.
 *
 * When a bundle (Tasks, Stoop, Folio) launches and detects the Hub via
 * `@onderling/react-native/hub-discovery`, it constructs a binder via
 * `@onderling/react-native/hub-binding` and uses `HubDelegateTransport`
 * instead of its usual `NknTransport` / `MqttTransport` / etc. The Hub
 * then owns the actual relay socket, BLE/mDNS scanners, and
 * foreground-service slot — one set per device instead of one per
 * bundle.
 *
 * Strict layering (locked 2026-05-11): core doesn't know what AIDL is
 * or what a Hub looks like. The `binder` arg is **duck-typed** — any
 * object that provides:
 *
 *   - `send(to, envelope) → Promise<void>`
 *   - `onIncoming(callback) → unsubscribe`
 *
 * ...is a valid binder. The Hub-binding substrate on RN ships an
 * implementation that satisfies this contract using AIDL under the
 * hood; tests use a fake JS object with the same shape.
 *
 * Phase 50.11 (Hub-track P4, direction-only) — see
 * `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.
 */

import { Transport } from './Transport.js';

/**
 * @typedef {object} HubBinder
 * @property {(to: string, envelope: object) => Promise<void>} send
 *   Outbound — the Hub forwards the envelope on the appropriate transport.
 * @property {(callback: (envelope: object) => void) => () => void} onIncoming
 *   Inbound — the Hub invokes `callback(envelope)` when a wire-level
 *   envelope addressed to this bundle arrives. Returns an unsubscribe
 *   function.
 * @property {() => Promise<void>} [close]
 *   Optional teardown; called on `disconnect()`.
 */

/**
 * Transport that delegates all wire I/O to a duck-typed Hub binder — any object with
 * `send(to, envelope)` and `onIncoming(callback)` (plus optional `close()`). Outbound
 * envelopes go to `binder.send`; inbound envelopes from the binder are fed into
 * `_receive`. Core stays ignorant of what the Hub actually is (AIDL on RN, fake in tests).
 */
export class HubDelegateTransport extends Transport {
  /** @type {HubBinder} */
  #binder;
  /** @type {(() => void) | null} */
  #unsubscribe = null;

  /**
   * @param {object} opts
   * @param {string}    opts.address   — this bundle's address (usually pubKey)
   * @param {HubBinder} opts.binder    — duck-typed Hub binder
   * @param {object}    [opts.identity] — AgentIdentity (optional; passed through to Transport)
   */
  constructor({ address, binder, identity } = {}) {
    super({ address, identity });
    if (!binder || typeof binder.send !== 'function' || typeof binder.onIncoming !== 'function') {
      throw Object.assign(
        new Error('HubDelegateTransport: `binder` must provide `send` and `onIncoming` methods'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    this.#binder = binder;
  }

  /** Read-only access to the binder (test seam). */
  get binder() { return this.#binder; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect() {
    // Wire the inbound callback.  The binder feeds raw envelopes (the
    // Hub already did the wire-level demux); we hand each to `_receive`
    // which runs SecurityLayer + dispatches.
    this.#unsubscribe = this.#binder.onIncoming((envelope) => {
      try { this._receive(envelope); } catch (err) { this.emit('error', err); }
    });
    this.emit('connect', { address: this.address });
  }

  async disconnect() {
    if (this.#unsubscribe) {
      try { this.#unsubscribe(); } catch { /* swallow */ }
      this.#unsubscribe = null;
    }
    if (typeof this.#binder.close === 'function') {
      try { await this.#binder.close(); } catch { /* swallow */ }
    }
    this.emit('disconnect');
  }

  // ── Wire primitive ─────────────────────────────────────────────────────────

  /**
   * Outbound — round-trip through the binder. The Hub picks the
   * appropriate transport on the other side (relay / BLE / mDNS).
   */
  async _put(to, envelope) {
    await this.#binder.send(to, envelope);
  }
}
