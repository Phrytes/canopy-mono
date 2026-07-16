/* global element, by, waitFor */
// Detox navigation helpers.
//
// M2 (2026-05-29) — the circle launcher is now the DEFAULT landing
// screen; the classic chat shell stays mounted underneath and is
// revealed via the launcher's "← chat" affordance (testID
// `circle-to-chat`).  Chat-focused tests call `gotoChat()` right after
// `device.launchApp(...)` to reveal the chat shell before asserting on
// its elements.

/**
 * Reveal the classic chat shell from the default circle launcher.
 * No-op if the launcher overlay isn't up (already on chat).  Resolves
 * once the chat header status is visible.
 */
async function gotoChat() {
  try {
    await waitFor(element(by.id('circle-to-chat'))).toBeVisible().withTimeout(60_000);
    await element(by.id('circle-to-chat')).tap();
  } catch {
    // Launcher overlay not present — assume we're already on chat.
  }
  await waitFor(element(by.id('chat-header-status'))).toBeVisible().withTimeout(60_000);
}

module.exports = { gotoChat };
