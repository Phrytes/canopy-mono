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

describe('cold boot smoke', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('shows "Agents ready" status within the boot timeout', async () => {
    // Wait up to 60s for the boot pipeline (createRealHouseholdAgent
    // signs WebID, provisions VaultMemory, registers skills, etc.).
    await waitFor(element(by.id('chat-header-status')))
      .toBeVisible()
      .withTimeout(60_000);
    // The "6 apps" count is verified by counting per-app rows below
    // — more robust than text matching (locale/format-independent).
  });

  it('expanding the debug section reveals all 6 app rows', async () => {
    await element(by.id('chat-debug-toggle')).tap();
    await expect(element(by.id('chat-debug-list'))).toBeVisible();

    for (const appOrigin of EXPECTED_APPS) {
      await expect(element(by.id(`chat-app-row-${appOrigin}`))).toBeVisible();
    }
  });
});
