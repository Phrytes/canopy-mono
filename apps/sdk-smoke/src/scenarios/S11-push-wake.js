/**
 * S11 — Push wake-up (E2c).
 *
 * Verifies the full E2c loop on a real device:
 *   1. This device registers for push (Expo) and obtains a device token.
 *   2. Token is shipped to the relay via `registerPushToken` on the
 *      already-connected RelayTransport.
 *   3. A `s11-wake` skill is registered on the agent.
 *   4. The user is told to background the app + run the laptop trigger:
 *        node apps/sdk-smoke/scripts/trigger-s11.mjs <relayUrl> <phone-pubkey>
 *      That trigger sends a `send` envelope addressed to this device.
 *   5. Relay queues the envelope (peer offline) and fires a silent push
 *      (`ExpoPushSender.send(token, {wake:true,hint:'message-pending'})`).
 *   6. iOS / Android wakes the JS engine.  RelayTransport reconnects,
 *      drains the queued envelope, A2A dispatches `s11-wake`.
 *   7. This run resolves with status='pass' once the skill fires.
 *
 * REQUIREMENTS:
 *   - Real device (simulator hides background-fetch behaviour).
 *   - `expo-notifications` peer-dep installed: `npx expo install expo-notifications`.
 *   - EAS project ID in `app.json` under `expo.extra.eas.projectId`
 *     (or env `EXPO_PUBLIC_EAS_PROJECT_ID`) — Expo can't mint a token without it.
 *   - Relay started with push enabled — see `apps/sdk-smoke/scripts/relay-with-push.js`.
 *
 * Returns status:
 *   - 'pass'     — wake skill fired within 60s.
 *   - 'fail'     — registration succeeded but no wake; OR registration failed.
 *   - 'pending'  — peer-dep missing / no project ID configured.
 */
import { defineSkill } from '@onderling/core';
import { MobilePushBridge } from '@onderling/react-native';

export const id    = 'S11';
export const title = 'Push wake-up (E2c)';

export async function run({ log, sdk }) {
  // 1. Peer-dep + adapter — lazy-import so the bundle works even without expo-notifications.
  let ExpoNotificationsAdapter;
  try {
    const adapterMod = await import(
      '@onderling/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js'
    );
    ExpoNotificationsAdapter = adapterMod.ExpoNotificationsAdapter;
  } catch (err) {
    log(`S11: SKIP — adapter import failed: ${err?.message ?? err}`);
    log('S11: install peer-dep with: npx expo install expo-notifications');
    return { status: 'pending', detail: 'expo-notifications not installed' };
  }

  // 2. EAS project ID — Expo can't mint a token without it on SDK 49+.
  let projectId = null;
  try {
    const Constants = (await import('expo-constants')).default;
    projectId =
      Constants?.expoConfig?.extra?.eas?.projectId
      ?? Constants?.easConfig?.projectId
      ?? null;
  } catch { /* expo-constants missing — fall through */ }
  if (!projectId) projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? null;
  if (!projectId) {
    log('S11: SKIP — EAS project ID not found.');
    log('S11: Add to app.json:  "expo.extra.eas.projectId": "<your-eas-project-uuid>"');
    log('S11:   or set env var EXPO_PUBLIC_EAS_PROJECT_ID before launching.');
    return { status: 'pending', detail: 'no EAS projectId configured' };
  }
  log(`S11: using EAS projectId ${projectId}`);

  // 3. Build bridge over the running agent + register for push.
  const bridge = new MobilePushBridge({ agent: sdk, adapter: new ExpoNotificationsAdapter() });
  let token, platform;
  try {
    const r = await bridge.register({ projectId });
    token    = r.token;
    platform = r.platform;
    log(`S11: ✓ push registered (${platform}) — token: ${token.slice(0, 28)}…`);
  } catch (err) {
    log(`S11: FAIL — bridge.register: ${err?.code ?? ''} ${err?.message ?? err}`);
    return { status: 'fail', detail: `bridge.register: ${err?.message ?? err}` };
  }

  // 4. Define a wake-skill so we can detect dispatch.  Use a Promise so the
  //    scenario resolves the moment the skill fires.
  let wakeResolve;
  const wakeFired = new Promise((resolve) => { wakeResolve = resolve; });
  const wakeAt    = { value: null };
  const skillDef  = defineSkill('s11-wake', async ({ parts }) => {
    wakeAt.value = Date.now();
    log(`S11: ✓ s11-wake skill ran (${parts?.length ?? 0} parts)`);
    wakeResolve(wakeAt.value);
    return [];                          // empty result; trigger script doesn't read it
  }, {
    description:  'S11 wake target — invoked by the laptop trigger after push wake.',
    visibility:   'authenticated',      // any registered peer can call
  });
  if (typeof sdk.skills?.register === 'function') {
    sdk.skills.register(skillDef);
  } else if (typeof sdk.defineSkill === 'function') {
    sdk.defineSkill('s11-wake', skillDef.handler);
  } else {
    log('S11: FAIL — agent has no skills.register / defineSkill');
    return { status: 'fail', detail: 'agent missing skill registry' };
  }
  log('S11: ✓ wake-skill `s11-wake` registered');

  // 5. Ship token to the relay.
  const relay = sdk.getTransport?.('relay');
  if (!relay || typeof relay.registerPushToken !== 'function') {
    log('S11: FAIL — agent has no relay transport with registerPushToken (rebuild with @onderling/core ≥ this session)');
    return { status: 'fail', detail: 'relay transport missing push registration' };
  }
  try {
    await relay.registerPushToken({ token, platform });
    log('S11: ✓ relay accepted register-push-token');
  } catch (err) {
    log(`S11: FAIL — relay.registerPushToken: ${err?.message ?? err}`);
    log('S11: did you start the relay with `new ExpoPushSender()`?');
    log('S11:   see apps/sdk-smoke/scripts/relay-with-push.js');
    return { status: 'fail', detail: `registerPushToken: ${err?.message ?? err}` };
  }

  // 6. Tell the user what to do.
  log('');
  log('S11: 📱  NOW: background this app, then on your laptop run:');
  log('');
  log('   npm run trigger:s11 -- <relayUrl-the-phone-uses> \\');
  log(`     ${sdk.address}`);
  log('   (or directly: node apps/sdk-smoke/scripts/trigger-s11.mjs <url> <pubkey>)');
  log('');
  log('S11: waiting up to 60s for the wake skill to fire…');

  // 7. Race wake skill fire against a 60s timeout.
  const TIMEOUT_MS = 60_000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('no wake within 60s')), TIMEOUT_MS);
  });

  try {
    await Promise.race([wakeFired, timeout]);
    return {
      status: 'pass',
      detail: `wake delivered + skill ran${wakeAt.value ? ` at ${new Date(wakeAt.value).toISOString()}` : ''}`,
    };
  } catch (err) {
    return { status: 'fail', detail: err?.message ?? 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}
