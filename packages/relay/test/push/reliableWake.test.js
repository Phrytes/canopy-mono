/**
 * Reliable-wake payload (offline-delivery M2 substrate).
 *
 * Proves the RELIABLE wake shape — alert-push + `mutable-content:1` + a
 * CONTENTLESS data body — behind the `PushSender` port, purely + hermetically
 * (no network). The device-side NSE that consumes `mutable-content` is the
 * native follow-up (see the iOS reliable-wake runbook); here we assert only the
 * server-side payload the substrate emits.
 */
import { describe, it, expect } from 'vitest';
import { ExpoPushSender, ReliableExpoPushSender } from '../../src/push/ExpoPushSender.js';
import {
  buildExpoWakeBody, assertContentlessWake,
  CONTENTLESS_WAKE, RELIABLE_WAKE_ALERT, WAKE_MODES,
} from '../../src/push/wakePayload.js';

function mockFetch(impl) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return impl({ url, init }); };
  fn.calls = calls;
  return fn;
}
const okJson = () => ({
  ok: true, status: 200, statusText: 'OK',
  text: async () => '{"data":{"status":"ok"}}',
  json: async () => ({ data: { status: 'ok' } }),
});

describe('reliable-wake payload — pure builder', () => {
  it('CONTENTLESS_WAKE names nobody and nothing', () => {
    expect(CONTENTLESS_WAKE).toEqual({ wake: true, hint: 'message-pending' });
  });

  it('reliable body = alert + mutable-content + contentless data (NOT silent)', () => {
    const body = buildExpoWakeBody({ token: 'tok', mode: WAKE_MODES.reliable });
    expect(body.mutableContent).toBe(true);                 // → APNs mutable-content:1 → NSE
    expect(body.title).toBe(RELIABLE_WAKE_ALERT.title);     // generic placeholder alert
    expect(body.body).toBe(RELIABLE_WAKE_ALERT.body);
    expect(body._contentAvailable).toBeUndefined();         // NOT the silent path
    // Contentless: data carries only the wake keys — no sender/circle/content.
    expect(Object.keys(body.data).sort()).toEqual(['hint', 'wake']);
  });

  it('silent body = content-available (the v0 unreliable default)', () => {
    const body = buildExpoWakeBody({ token: 'tok', mode: WAKE_MODES.silent });
    expect(body._contentAvailable).toBe(true);
    expect(body.mutableContent).toBeUndefined();
  });

  it('assertContentlessWake rejects smuggled sender/content', () => {
    expect(() => assertContentlessWake({ wake: true, sender: 'ann' })).toThrow(/contentless/);
    expect(() => assertContentlessWake({ wake: true, body: 'secret text' })).toThrow(/contentless/);
    expect(assertContentlessWake(CONTENTLESS_WAKE)).toBe(CONTENTLESS_WAKE);
  });
});

describe('ReliableExpoPushSender — over the (mocked) Expo wire', () => {
  it('posts a reliable body: mutable-content + generic alert + contentless data', async () => {
    const fetchFn = mockFetch(okJson);
    const sender = new ReliableExpoPushSender({ fetch: fetchFn });
    expect(sender.mode).toBe('reliable');
    const res = await sender.send('ExponentPushToken[x]', { ...CONTENTLESS_WAKE }, { platform: 'ios' });
    expect(res).toEqual({ ok: true });

    const body = JSON.parse(fetchFn.calls[0].init.body);
    expect(body.mutableContent).toBe(true);
    expect(body.title).toBe(RELIABLE_WAKE_ALERT.title);
    expect(body.body).toBe(RELIABLE_WAKE_ALERT.body);
    expect(body._contentAvailable).toBeUndefined();
    expect(body.data).toEqual({ wake: true, hint: 'message-pending' });
  });

  it('ExpoPushSender default stays SILENT (back-compat)', async () => {
    const fetchFn = mockFetch(okJson);
    const sender = new ExpoPushSender({ fetch: fetchFn });
    expect(sender.mode).toBe('silent');
    await sender.send('t', { ...CONTENTLESS_WAKE });
    const body = JSON.parse(fetchFn.calls[0].init.body);
    expect(body._contentAvailable).toBe(true);
    expect(body.mutableContent).toBeUndefined();
  });
});
