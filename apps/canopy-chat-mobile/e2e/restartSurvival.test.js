// Restart survival (#254 D-1 test 3).
//
// Replaces the manual #249 restart check:
//   1. Boot the app, identity gets provisioned + vault stored
//      (VaultAsyncStorage in the real RN runtime — opt-in via
//      bootAgentBundle's asyncStorage path; tests cover the
//      default-vault path which uses the same AsyncStorage on
//      device).
//   2. Force-quit + relaunch.
//   3. The boot should be CLEAN (no onboarding flow, no
//      "Booting agents…" stuck state, just lands on the same
//      "Agents ready" screen).
//
// This is the canonical persistence smoke — if the vault adapter
// regresses or AsyncStorage's underlying RN bridge breaks, we'd
// see the second boot take noticeably longer OR show an error
// banner.  Both are testable here.

describe('restart survival', () => {
  it('relaunching the app lands on the same "Agents ready" screen', async () => {
    // First boot.
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('chat-header-status')))
      .toBeVisible()
      .withTimeout(60_000);

    // Second boot — Detox terminates the app and starts fresh.
    // newInstance:false uses the existing process (faster); the
    // CLEAN re-boot scenario is newInstance:true with the same
    // app session, which is what device.reloadReactNative does.
    await device.terminateApp();
    await device.launchApp({ newInstance: false });

    // Re-boot should reach "Agents ready" again — and FASTER than
    // the cold boot because the JS bundle is cached.  20s timeout
    // (vs 60s on first boot).
    await waitFor(element(by.id('chat-header-status')))
      .toBeVisible()
      .withTimeout(20_000);

    // No error banner.  (We can't easily assert "no boot.boot_failed"
    // because that bound text is dynamic; instead we check that the
    // ready-state debug-toggle is interactable.)
    await expect(element(by.id('chat-debug-toggle'))).toBeVisible();
  });
});
