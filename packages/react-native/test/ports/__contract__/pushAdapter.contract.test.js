/**
 * PushAdapter port contract.
 *
 * Every PushAdapter concrete (and the Mock) must satisfy these.  A future
 * `PushAdapter.ios` / `.android` (Slice 3) is "done" when it passes this suite.
 *
 * The Expo concrete (`ExpoNotificationsAdapter`) statically imports
 * `expo-notifications`, which is a peer dep NOT installed in this package, so
 * it can't be constructed here.  It is contract-covered where that dep exists:
 * `transport/MobilePushBridge.test.js` (register/notify/unregister) and the
 * basis-mobile app suite (`presentLocal` via the shared helper).
 */
import { describe, it, expect, vi } from 'vitest';
import { MockPushAdapter } from '../../../src/ports/mocks/MockPushAdapter.js';
import { IosPushAdapter }  from '../../../src/ports/pushAdapters/IosPushAdapter.js';

/** @param {() => import('../../../src/ports/PushAdapter.js').PushAdapter} make */
function runPushAdapterContract(name, make, makeDenied) {
  describe(`PushAdapter contract — ${name}`, () => {
    it('register() resolves { token, platform }', async () => {
      const reg = await make().register({ projectId: 'eas-1' });
      expect(typeof reg.token).toBe('string');
      expect(['ios', 'android', 'web']).toContain(reg.platform);
    });

    it('register() throws PUSH_PERMISSION_DENIED when permission is denied', async () => {
      await expect(makeDenied().register()).rejects.toMatchObject({ code: 'PUSH_PERMISSION_DENIED' });
    });

    it('onNotification() delivers, and its unsubscribe is idempotent', async () => {
      const a = make();
      const handler = vi.fn();
      const unsub = a.onNotification(handler);
      a._fire({ skillId: 'wake' });
      expect(handler).toHaveBeenCalledTimes(1);
      unsub();
      unsub();                       // idempotent — no throw, no re-add
      a._fire({ skillId: 'wake' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unregister() tears down listeners (idempotent)', async () => {
      const a = make();
      a.onNotification(vi.fn());
      await a.unregister();
      await a.unregister();          // idempotent
      expect(a._subscriberCount).toBe(0);
    });

    it('presentLocal() resolves a boolean', async () => {
      const a = make();
      const ok = await a.presentLocal({ title: 't', body: 'b', data: { round: 1 } });
      expect(typeof ok).toBe('boolean');
      expect(ok).toBe(true);
    });
  });
}

runPushAdapterContract(
  'MockPushAdapter',
  () => new MockPushAdapter(),
  () => new MockPushAdapter({ denyPermission: true }),
);

// The iOS reliable-wake SLOT (⚠️ scaffold): its JS surface must satisfy the port
// contract today so shared code binds to it — the NSE/BGTask native side is the
// documented follow-up (see docs/ios-reliable-wake-runbook.md), NOT tested here.
runPushAdapterContract(
  'IosPushAdapter (scaffold)',
  () => new IosPushAdapter(),
  () => new IosPushAdapter({ denyPermission: true }),
);
