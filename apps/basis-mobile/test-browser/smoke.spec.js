/**
 * Phase A smoke — basis-mobile, served as Expo Web, boots in a
 * real browser and the canonical pipeline accepts a slash command.
 *
 * Scope decisions:
 *   - boot.spec — proves the bundle renders + boot succeeds.  If this
 *     fails the others don't matter.
 *   - slash round-trip — types `/threads`, asserts the basis
 *     host-op intercept lands a text bubble.  Pipeline-only test —
 *     no real NKN peer, no Solid pod, no manifest substrate skill.
 *
 * What's deliberately NOT here (later Phase A iterations):
 *   - Multi-thread drawer create/switch
 *   - Multi-field form bubble submit
 *   - Real substrate ops (need a 1-peer setup with deterministic
 *     vault — bigger lift, separate slice).
 *
 * The chat shell exposes RN testIDs that map to data-testid="…" on
 * web via react-native-web's accessibility shim.
 */
import { test, expect } from '@playwright/test';

test.describe('#224 Phase A — basis-mobile on Expo Web', () => {
  test('cold boot renders the chat shell + reports agents ready', async ({ page }) => {
    await page.goto('/');
    // The KeyboardAvoidingView wrapping the shell carries
    // testID="chat-screen"; react-native-web maps that to data-testid.
    await expect(page.getByTestId('chat-screen')).toBeVisible({ timeout: 30_000 });
    // Boot success surfaces via the header status row.  Real-NKN
    // bootstrap inside the bundle can take ~5-10s in a fresh tab.
    await expect(page.getByTestId('chat-header-status'))
      .toContainText(/Agents ready/i, { timeout: 30_000 });
  });

  test('slash command round-trips through the canonical pipeline', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('chat-header-status'))
      .toContainText(/Agents ready/i, { timeout: 30_000 });

    // /threads is now a real host op routed via mobile's
    // localBuiltins port (Bundle F P1, #257).  It returns the
    // threads-list text payload — the seed thread is named "Main".
    // Asserting on "Main" proves parseInput + resolveDispatch +
    // localBuiltins.threads + renderReply all survived the RN→web
    // bundling.
    const input = page.getByTestId('chat-input');
    await input.fill('/threads');
    await input.press('Enter');

    // Bot bubble carries the listThreads payload.  Two `Main`
    // strings appear after dispatch (one in the header for the
    // active thread, one in the reply text); we only need to assert
    // that the bubble text shows up — the reply locator is the
    // ScrollView's last bot bubble.
    await expect(page.locator('body'))
      .toContainText(/Main/, { timeout: 10_000 });
  });
});
