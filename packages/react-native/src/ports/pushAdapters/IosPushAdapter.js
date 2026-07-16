/**
 * IosPushAdapter — the `PushAdapter.ios` SLOT for the reliable-wake path.
 * @implements PushAdapter
 *
 * ⚠️ SCAFFOLD — NEEDS ON-DEVICE VERIFICATION BY FRITS. The JS surface here is
 * real and satisfies the {@link PushAdapter} contract (so shared code binds to
 * it today), but the load-bearing iOS behaviour is NATIVE (Swift, an NSE + APNs)
 * and CANNOT be built or verified in this environment (no Apple account/device).
 * Every native step is a documented `@todo native`. See the iOS reliable-wake
 * runbook: `docs/ios-reliable-wake-runbook.md`.
 *
 * ── What the native side must do (the reliable "wake → pull → render" loop) ───
 * On iOS a backgrounded/killed app's sockets freeze; only an Apple-routed push
 * wakes it. The RELIABLE path (Signal/Element) is an ALERT push carrying
 * `mutable-content: 1`, which hands CPU to a **Notification Service Extension
 * (NSE)** — a separate process — on ~every delivery, BEFORE the alert shows:
 *
 *   1. The relay/companion node sends the CONTENTLESS reliable wake
 *      (`ReliableExpoPushSender` — alert + `mutable-content:1`, data `{wake,hint}`,
 *      a GENERIC placeholder alert naming nobody/nothing).
 *   2. iOS invokes the **NSE** (native). The NSE:
 *        a. reads the App-Group-shared session/keys (see {@link SecureStore});
 *        b. FETCHES the sealed blob from the owner's companion inbox
 *           (`inbox.drain`, capability-gated) — the node holds it durably;
 *        c. OPENS it locally with the recipient key (`@onderling/pod-client/sealing`
 *           `open`) — decryption happens ON DEVICE, never on the node;
 *        d. REWRITES `content.title/body` with the real (now-decrypted) message,
 *           or suppresses it, before the system shows the alert.
 *   3. When the app next foregrounds, {@link BackgroundAdapter} cold-start drain
 *      pulls anything the NSE didn't, so nothing is missed.
 *
 * The JS methods below are the bridge the NSE/app calls into (register token,
 * deliver a decoded notification, present a local alert). The NSE ITSELF is
 * native and is the follow-up Frits verifies with the "S11 app KILLED" test.
 */
import { PushAdapter } from '../PushAdapter.js';

export class IosPushAdapter extends PushAdapter {
  #handlers = new Set();
  #native;
  #denyPermission;

  /**
   * @param {object} [opts]
   * @param {object} [opts.native]   the native bridge (APNs/Expo + NSE). In
   *   production the app injects the real module; device-free tests inject a
   *   fake (or omit it to use the built-in stub so the contract can run).
   * @param {boolean} [opts.denyPermission]  simulate a denied permission (tests).
   * @param {string}  [opts.token]    stub token when no native bridge is present.
   */
  constructor({ native, denyPermission = false, token = 'ios-apns-stub-token' } = {}) {
    super();
    this.#native = native ?? null;
    this.#denyPermission = denyPermission;
    this._stubToken = token;
    this._localGranted = true;
  }

  /**
   * Request APNs permission + an alert-capable push token.
   * @todo native — call the real APNs/Expo permission + token APIs; the token
   *   must be ALERT-capable (not silent-only) so `mutable-content` reaches the NSE.
   */
  async register(opts) {
    if (this.#denyPermission) {
      throw Object.assign(new Error('Push permission denied'), { code: 'PUSH_PERMISSION_DENIED' });
    }
    if (this.#native?.requestPushToken) {
      const r = await this.#native.requestPushToken(opts);
      return { token: r.token, platform: 'ios' };
    }
    return { token: this._stubToken, platform: 'ios' };
  }

  /**
   * Subscribe to incoming (post-NSE, decoded) notifications. The native NSE/app
   * bridge calls {@link _deliver} to fan a decoded notification to subscribers.
   */
  onNotification(handler) {
    this.#handlers.add(handler);
    return () => { this.#handlers.delete(handler); };
  }

  /** Tear down listeners; idempotent. */
  async unregister() {
    this.#handlers.clear();
    try { await this.#native?.unregister?.(); } catch { /* idempotent */ }
  }

  /**
   * Present a LOCAL notification (the on-device render after a pull/decrypt).
   * @todo native — bridge to `expo-notifications`/UNUserNotificationCenter.
   */
  async presentLocal(notification) {
    if (this.#native?.presentLocal) return Boolean(await this.#native.presentLocal(notification ?? {}));
    return this._localGranted === true;
  }

  /**
   * Native/app bridge entry: deliver a decoded notification to subscribers.
   * The NSE (native) calls this after it fetches + decrypts the sealed blob.
   */
  _deliver(data, foreground = false) {
    for (const h of this.#handlers) h({ data, foreground });
  }

  /** Test alias for {@link _deliver} (matches the PushAdapter contract driver). */
  _fire(data, foreground = true) { this._deliver(data, foreground); }

  /** Live subscriber count (contract introspection). */
  get _subscriberCount() { return this.#handlers.size; }
}
