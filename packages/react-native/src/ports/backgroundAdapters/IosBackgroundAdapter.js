/**
 * IosBackgroundAdapter — the `BackgroundAdapter.ios` SLOT for the cold-start
 * reconnect-and-drain lifecycle.
 * @implements BackgroundAdapter
 *
 * ⚠️ SCAFFOLD — NEEDS ON-DEVICE VERIFICATION BY FRITS. The JS surface satisfies
 * the {@link BackgroundAdapter} contract (shared code binds to it today), but the
 * load-bearing behaviour is NATIVE (BGTaskScheduler + the NSE-driven reconnect)
 * and CANNOT be built/verified here. Every native step is a documented
 * `@todo native`. See `docs/ios-reliable-wake-runbook.md`.
 *
 * ── What the native side must do ──────────────────────────────────────────────
 * iOS gives a backgrounded app only opportunistic, seconds-long CPU windows; it
 * cannot hold a socket. So "never miss a message" on iOS is a DRAIN-ON-WAKE loop,
 * not a persistent connection:
 *
 *   • `defineColdStartTask(handler)` — register a **BGTaskScheduler** task
 *     (`BGAppRefreshTask` / `BGProcessingTask`) at JS-bundle load (before the
 *     engine exists — the `bgRunOnce` constraint). On a cold start / OS wake the
 *     task runs `handler` = ONE sync pass: reconnect to the relay, `inbox.drain`
 *     the companion node, decrypt + persist, render local notifications, return.
 *     @todo native — `BGTaskScheduler.register(forTaskWithIdentifier:)` +
 *       `UIBackgroundModes` (`fetch`, `processing`, `remote-notification`).
 *   • `scheduleReconnect(opts)` — submit a `BGAppRefreshTaskRequest` for periodic
 *     opportunistic reconnects. @todo native.
 *   • `onWake(handler)` — the NSE / remote-notification wake points the run-once
 *     singleton at `handler` so the wake triggers exactly the cold-start drain.
 *   • `onAppStateChange(handler)` — foreground/background transitions (drain +
 *     resume cadence on foreground; flush + schedule a refresh on background).
 *   • `teardown()` — cancel scheduled tasks + clear the singleton (sign-out).
 *
 * The genuinely-native pieces (BGTaskScheduler, the NSE process, App-Group) live
 * behind this port; everything above it (the sync pass, drain, decrypt) is shared
 * code the port hands control to.
 */
import { BackgroundAdapter } from '../BackgroundAdapter.js';

export class IosBackgroundAdapter extends BackgroundAdapter {
  #native;
  #coldStartHandler = null;
  #wakeHandlers = new Set();
  #appStateHandlers = new Set();
  #scheduled = false;

  /**
   * @param {object} [opts]
   * @param {object} [opts.native]  the native bridge (BGTaskScheduler + NSE).
   *   Production injects the real module; device-free tests inject a fake (or
   *   omit it — the built-in stub lets the contract run).
   */
  constructor({ native } = {}) {
    super();
    this.#native = native ?? null;
  }

  /** @todo native — register the BGTaskScheduler task at bundle-load. */
  defineColdStartTask(handler) {
    this.#coldStartHandler = handler;
    this.#native?.registerColdStartTask?.(handler);
  }

  /** @todo native — submit a BGAppRefreshTaskRequest for periodic reconnects. */
  async scheduleReconnect(opts = {}) {
    this.#scheduled = true;
    if (this.#native?.scheduleReconnect) return this.#native.scheduleReconnect(opts);
    return { scheduled: true };
  }

  /** Point the run-once drain at `handler`; unsubscribe removes it (idempotent). */
  onWake(handler) {
    this.#wakeHandlers.add(handler);
    return () => { this.#wakeHandlers.delete(handler); };
  }

  /** Subscribe to foreground/background transitions (idempotent unsubscribe). */
  onAppStateChange(handler) {
    this.#appStateHandlers.add(handler);
    return () => { this.#appStateHandlers.delete(handler); };
  }

  /** Cancel scheduled tasks + clear all subscriptions; idempotent. */
  async teardown() {
    this.#wakeHandlers.clear();
    this.#appStateHandlers.clear();
    this.#coldStartHandler = null;
    if (this.#scheduled) { try { await this.#native?.cancelScheduled?.(); } catch { /* idempotent */ } }
    this.#scheduled = false;
  }

  /** Native/app bridge entry — an OS wake runs the cold-start drain handlers. */
  _wake() { for (const h of this.#wakeHandlers) h(); }
  /** Native/app bridge entry — a foreground/background transition. */
  _appState(state) { for (const h of this.#appStateHandlers) h(state); }
}
