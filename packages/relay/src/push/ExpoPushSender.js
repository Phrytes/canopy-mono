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
 * The send body is data-only by default (`_contentAvailable: true`) so it
 * wakes the app silently without showing a system notification — this is
 * what we want for "wake the agent so it can fetch a queued message".
 * Apps that want a visible notification should configure `payload.title` /
 * `payload.body` themselves; the sender forwards them through.
 *
 * Auth: optional `accessToken` for Expo's "enhanced security" mode
 * (https://docs.expo.dev/push-notifications/sending-notifications/#additional-security).
 * For OSS and dev workflows, no token is required.
 */
import { PushSender } from './PushSender.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export class ExpoPushSender extends PushSender {
  #fetch;
  #accessToken;
  #endpoint;

  /**
   * @param {object} [opts]
   * @param {typeof fetch} [opts.fetch]       — defaults to globalThis.fetch
   * @param {string}       [opts.accessToken] — optional Expo access token
   * @param {string}       [opts.endpoint]    — override (tests / private proxy)
   */
  constructor({ fetch: fetchImpl, accessToken, endpoint } = {}) {
    super();
    this.#fetch       = fetchImpl ?? globalThis.fetch;
    this.#accessToken = accessToken ?? null;
    this.#endpoint    = endpoint ?? EXPO_PUSH_URL;
    if (typeof this.#fetch !== 'function') {
      throw new Error('ExpoPushSender: a fetch implementation is required (globalThis.fetch missing?)');
    }
  }

  async send(token, payload, opts = {}) {
    if (!token || typeof token !== 'string') {
      return { ok: false, error: 'invalid-token' };
    }

    const body = {
      to:                token,
      data:              payload ?? {},
      priority:          opts.priority ?? 'high',
      // Silent wake-up: data-only push, no UI. iOS-specific but Expo proxies
      // it correctly to the underlying APNs/FCM payload.
      _contentAvailable: true,
    };
    // Optional UI fields — only include if the caller asked.
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
