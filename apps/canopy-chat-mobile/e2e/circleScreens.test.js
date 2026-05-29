// Circle settings-family screens reachable from the launcher (v2 M3,
// 2026-05-29).
//
// The launcher is the default screen (M2).  This verifies the M3 RN
// port of the availability screen end-to-end on device: it opens from
// the launcher, a Switch toggles, and Save returns to the launcher
// (persisting through the AsyncStorage-backed store).
//
// The per-circle Settings / My-settings screens carry testIDs
// (circle-settings / circle-override, reached via circle-detail-settings
// / circle-detail-mine) but need a created circle to navigate into, so
// they're left to the real-device pass + the vitest-covered shared model.
//
// Runs against the RELEASE APK (embedded JS bundle).

describe('circle availability screen (M3)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(60_000);
  });

  it('opens Availability from the launcher, toggles holiday, Saves back to the launcher', async () => {
    await element(by.id('circle-tab-mij')).tap();
    await waitFor(element(by.id('circle-availability')))
      .toBeVisible()
      .withTimeout(10_000);

    // Toggle holiday mode (RN Switch) + save.
    await element(by.id('holiday-active')).tap();
    await element(by.id('circle-availability-save')).tap();

    // Save returns to the launcher.
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });

  it('Availability "back" also returns to the launcher', async () => {
    await element(by.id('circle-tab-mij')).tap();
    await waitFor(element(by.id('circle-availability')))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('circle-availability-back')).tap();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });

  it('opens the cross-circle Stream from the launcher + back returns', async () => {
    await element(by.id('circle-tab-stroom')).tap();
    await waitFor(element(by.id('circle-stream')))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('circle-stream-back')).tap();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });
});
