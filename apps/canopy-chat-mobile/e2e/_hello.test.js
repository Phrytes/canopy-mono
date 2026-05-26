// Detox sanity check (#254 — D-0 sanity).  Minimal — just proves
// that the build-test-launch loop works.  If this fails, the
// problem isn't in our test logic.
//
// Runs against the RELEASE APK (embedded JS bundle, no
// expo-dev-launcher).  Metro doesn't need to be running.

describe('Detox sanity', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Disable synchronization AFTER launch (the bridge has to exist
    // before this call can route through).  Our app has perpetual
    // background work (NknTransport reconnect loop, periodic
    // catch-up timers, …) that never goes idle, so the default
    // sync-on-idle would time out.
    await device.disableSynchronization();
  });

  it('app launches and the chat screen is visible', async () => {
    await waitFor(element(by.id('chat-screen')))
      .toBeVisible()
      .withTimeout(60_000);
  });
});
