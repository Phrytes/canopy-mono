/**
 * MockPushAdapter — device-free {@link PushAdapter} for tests.
 *
 * Records calls and lets a test drive the notification stream via `_fire`.
 * Honours the contract: `register` returns `{token, platform}` (or throws
 * `PUSH_PERMISSION_DENIED` when constructed with `denyPermission`), the
 * `onNotification` unsubscribe is idempotent, `unregister` tears down
 * listeners, and `presentLocal` records + returns a configurable result.
 */
import { PushAdapter } from '../PushAdapter.js';

export class MockPushAdapter extends PushAdapter {
  #handlers = new Set();

  constructor({
    token = 'mock-token',
    platform = 'ios',
    denyPermission = false,
    localGranted = true,
  } = {}) {
    super();
    this.token = token;
    this.platform = platform;
    this.denyPermission = denyPermission;
    this.localGranted = localGranted;
    this.registered = false;
    this.presented = [];       // recorded presentLocal payloads
    this.registerCalls = [];
  }

  async register(opts) {
    this.registerCalls.push(opts);
    if (this.denyPermission) {
      throw Object.assign(new Error('Push permission denied'), { code: 'PUSH_PERMISSION_DENIED' });
    }
    this.registered = true;
    return { token: this.token, platform: this.platform };
  }

  onNotification(handler) {
    this.#handlers.add(handler);
    return () => { this.#handlers.delete(handler); };
  }

  async unregister() {
    this.#handlers.clear();
    this.registered = false;
  }

  async presentLocal(notification) {
    this.presented.push(notification ?? {});
    return this.localGranted === true;
  }

  /** Test helper — deliver a notification to all live subscribers. */
  _fire(data, foreground = true) {
    for (const h of this.#handlers) h({ data, foreground });
  }

  /** Test helper — number of live subscribers. */
  get _subscriberCount() { return this.#handlers.size; }
}
