// Cold boot smoke (#254 D-1 test 1).
//
// Replaces the first half of the manual #249 checklist:
//   1. App cold-boots without redbox
//   2. "Agents ready — 6 apps" appears
//   3. Expanding the debug section shows all 6 NavModel rows
//      (canopy-chat, household, tasks-v0, stoop, folio, calendar)
//
// First boot is slow (vault + secure-agent + stoop-factory chain),
// so the wait timeout is generous (60s).
//
// Run via:
//   pnpm exec detox build --configuration android.emu.debug
//   pnpm exec detox test  --configuration android.emu.debug e2e/coldBoot.test.js

const EXPECTED_APPS = [
  'canopy-chat',
  'household',
  'tasks-v0',
  'stoop',
  'folio',
  'calendar',
];

const { gotoChat } = require('./support/nav.js');

describe('cold boot smoke', () => {
  beforeAll(async () => {
    // The app's NKN keepalive/reconnect setInterval timers never let RN go
    // idle, so Detox's launch-time synchronization waits forever (the 192s
    // "waiting for ready" timeout on TimersIdlingResource). Launch with
    // synchronization disabled natively (detoxEnableSynchronization: 0) so
    // launchApp doesn't block on the never-idle bridge.
    await device.launchApp({ newInstance: true, launchArgs: { detoxEnableSynchronization: 0 } });
    await device.disableSynchronization();
    await gotoChat();
  });

  it('shows "Agents ready" status within the boot timeout', async () => {
    // gotoChat already waited for the boot status; re-assert for clarity.
    await waitFor(element(by.id('chat-header-status')))
      .toBeVisible()
      .withTimeout(60_000);
    // The "6 apps" count is verified by counting per-app rows below
    // — more robust than text matching (locale/format-independent).
  });

  it('expanding the debug section reveals all 6 app rows', async () => {
    await element(by.id('chat-debug-toggle')).tap();
    await waitFor(element(by.id('chat-debug-list'))).toBeVisible().withTimeout(5_000);

    for (const appOrigin of EXPECTED_APPS) {
      await expect(element(by.id(`chat-app-row-${appOrigin}`))).toBeVisible();
    }
  });
});
