// Slash command round-trip (#254 D-1 test 2).
//
// Replaces the manual #253 step-2 verification:
//   1. Type "/mine" into the chat input
//   2. Tap Send
//   3. A list bubble appears with at least one row showing a button
//      (household's markComplete is appliesTo: { type:'chore', state:'open' };
//      mockHouseholdManifest's default chores start in 'open' state so the
//      button lights up).
//
// This exercises the full dispatch pipeline end-to-end on real
// Hermes: parseInput → resolveDispatch → runDispatch (callSkill to
// household via InternalTransport) → renderReply (with the canonical
// opts that include manifestsByOrigin so inline keyboards populate).
//
// If buttonCount goes to 0 on regression, this test catches the
// "/mine works but no buttons" bug we hit 2026-05-26.

describe('slash command round-trip', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Wait for boot.
    await waitFor(element(by.id('chat-header-status')))
      .toBeVisible()
      .withTimeout(60_000);
  });

  it('typing /mine + Send produces a list bubble with at least one button row', async () => {
    await element(by.id('chat-input')).typeText('/mine');
    await element(by.id('chat-send')).tap();

    // The bot bubble is the LIST one — wait for its container to land.
    // We don't know the msg id ahead of time, so we scope on the
    // first matching list bubble via the chat-screen ancestor.
    // 30s is enough for the household.listOpen skill + render round-trip.
    await waitFor(element(by.id('chat-screen').withDescendant(by.id(/^bubble-bot-list-/))))
      .toBeVisible()
      .withTimeout(30_000)
      .catch(async () => {
        // Fallback assertion if Detox's regex-id matcher misbehaves —
        // just check that SOME list-row landed.
        await expect(element(by.id(/^list-row-/)).atIndex(0)).toBeVisible();
      });

    // At least one row button must be visible.  The mock household
    // ships with 3 chores in state 'open' from the factory's seed.
    await expect(element(by.id(/^list-row-btn-markComplete-/)).atIndex(0))
      .toBeVisible();
  });
});
