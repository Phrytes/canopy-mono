/**
 * ExpoPushSender — concrete `PushSender` calling Expo's HTTP push API.
 *
 * Endpoint:  POST https://exp.host/--/api/v2/push/send
 * Docs:      https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Accepts:
 *   - Expo push tokens (`ExponentPushToken[...]`) — most common.
 *   - Direct FCM/APNs tokens, when the receiver app is configured to send
 *     them (Expo proxies in that case).
 *
 * Wake MODES (offline-delivery reliable-wake work — see `wakePayload.js`):
 *   • SILENT   (default) — data-only `_contentAvailable: true`: wakes the app
 *     without UI. iOS's UNRELIABLE path ("opportunistic, not guaranteed"). This
 *     is the v0 behaviour and stays the default for full back-compat.
 *   • RELIABLE (`mode: 'reliable'`) — alert-push + `mutable-content: 1` with a
 *     GENERIC placeholder alert: the reliable path Signal/Element use, where an
 *     NSE gets CPU on ~every delivery to fetch + decrypt + rewrite the alert.
 *     The payload stays CONTENTLESS (the placeholder names nobody/nothing; the
 *     device pulls the sealed content on wake). Construct via
 *     `new ExpoPushSender({ mode: 'reliable' })` or `new ReliableExpoPushSender()`.
 *
 * In BOTH modes the caller's `payload.title`/`payload.body` still override the
 * defaults (general-purpose sender), and arbitrary `data` passes through — the
 * CONTENTLESS discipline for the wake is the relay's/inbox's responsibility
 * (they send `{wake, hint}`; see `wakePayload.CONTENTLESS_WAKE`).
 *
 * Auth: optional `accessToken` for Expo's "enhanced security" mode
 * (https://docs.expo.dev/push-notifications/sending-notifications/#additional-security).
 * For OSS and dev workflows, no token is required.
 */
import { PushSender }        from './PushSender.js';
import { WAKE_MODES, RELIABLE_WAKE_ALERT } from './wakePayload.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export class ExpoPushSender extends PushSender {
  #fetch;
  #accessToken;
  #endpoint;
  #mode;

  /**
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetch]       — defaults to globalThis.fetch
   * @param {string}       [opts.accessToken] — optional Expo access token
   * @param {string}       [opts.endpoint]    — override (tests / private proxy)
   * @param {'silent'|'reliable'} [opts.mode='silent'] — wake shape (see header)
   */
  constructor({ fetch: fetchImpl, accessToken, endpoint, mode } = {}) {
    super();
    this.#fetch       = fetchImpl ?? globalThis.fetch;
    this.#accessToken = accessToken ?? null;
    this.#endpoint    = endpoint ?? EXPO_PUSH_URL;
    this.#mode        = mode === WAKE_MODES.reliable ? WAKE_MODES.reliable : WAKE_MODES.silent;
    if (typeof this.#fetch !== 'function') {
      throw new Error('ExpoPushSender: a fetch implementation is required (globalThis.fetch missing?)');
    }
  }

  /** The configured wake mode ('silent' | 'reliable'). */
  get mode() { return this.#mode; }

  async send(token, payload, opts = {}) {
    if (!token || typeof token !== 'string') {
      return { ok: false, error: 'invalid-token' };
    }

    const reliable = this.#mode === WAKE_MODES.reliable;
    const body = {
      to:       token,
      data:     payload ?? {},
      priority: opts.priority ?? 'high',
    };
    if (reliable) {
      // RELIABLE — alert-push + mutable-content:1: the NSE runs on ~every
      // delivery and rewrites the (generic, contentless) alert after it fetches
      // + decrypts the sealed blob. No silent content-available flag.
      body.mutableContent = true;
      body.title = RELIABLE_WAKE_ALERT.title;
      body.body  = RELIABLE_WAKE_ALERT.body;
    } else {
      // SILENT — data-only push, no UI (v0 default; UNRELIABLE on iOS). Expo
      // proxies it correctly to the underlying APNs/FCM payload.
      body._contentAvailable = true;
    }
    // Optional UI fields — caller override always wins (general-purpose sender).
    if (payload?.title) body.title = payload.title;
    if (payload?.body)  body.body  = payload.body;

    const headers = {
      'accept':       'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    };
    if (this.#accessToken) {
      headers.authorization = `Bearer ${this.#accessToken}`;
    }

    let res;
    try {
      res = await this.#fetch(this.#endpoint, {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, error: `network: ${err?.message ?? err}` };
    }

    if (!res.ok) {
      // Read text best-effort; Expo's error bodies are short.
      let text;
      try { text = await res.text(); } catch { text = ''; }
      return { ok: false, error: `${res.status} ${res.statusText}: ${text.slice(0, 200)}` };
    }

    let json;
    try { json = await res.json(); }
    catch (err) { return { ok: false, error: `invalid-json: ${err?.message ?? err}` }; }

    // Expo returns `{data: {status: 'ok'|'error', ...}}` (single send) or
    // `{data: [{status, ...}, ...]}` (batch).  We send one ticket at a
    // time, so handle both shapes defensively.
    const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
    if (!ticket) return { ok: false, error: 'no-ticket' };
    if (ticket.status === 'ok') return { ok: true };
    return {
      ok:    false,
      error: `expo-error: ${ticket.message ?? ticket.details?.error ?? 'unknown'}`,
    };
  }
}

/**
 * ReliableExpoPushSender — an `ExpoPushSender` pinned to the RELIABLE wake mode
 * (alert-push + `mutable-content:1` → NSE). Inject this as the relay's
 * `pushSender` to upgrade the wake from the v0 silent (unreliable) path to the
 * reliable one, with NO other relay change (the reliable-ness is a property of
 * the injected sender — the relay just calls the `PushSender` port).
 */
export class ReliableExpoPushSender extends ExpoPushSender {
  constructor(opts = {}) {
    super({ ...opts, mode: WAKE_MODES.reliable });
  }
}
