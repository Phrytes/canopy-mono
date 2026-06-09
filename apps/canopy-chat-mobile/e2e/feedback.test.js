// M6 — feedback bot on the device. The device counterpart of the headless
// feedbackMount/feedbackContactItem tests: /contacts surfaces the feedback assistant as a
// DISTINCT 'agent' contact row (id 'fp-bot') carrying its own [Open chat] button (openFeedback),
// not a stoop [DM] peer button. Tapping it enters feedback mode (a bot reply lands).
//
// Deterministic — no LLM needed: the contact row is a static inject, and entering feedback mode
// sends '/help' to the co-hosted bot (handled deterministically).

const { gotoChat } = require('./support/nav.js');

describe('feedback bot — agent contact in /contacts', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();   // app has perpetual bg work (see slashRoundtrip)
    await gotoChat();
  });

  it('shows the feedback assistant as a distinct agent contact with its [Open chat] button', async () => {
    await element(by.id('chat-input')).typeText('/contacts');
    await element(by.id('chat-send')).tap();
    // feedbackContactItem id = 'fp-bot' → list-row-fp-bot; its openFeedback button →
    // list-row-btn-openFeedback-fp-bot (the shell's list-row testID convention). The item carries
    // its OWN buttons, so it gets [Open chat], NOT stoop's [DM].
    await waitFor(element(by.id('list-row-fp-bot'))).toBeVisible().withTimeout(30_000);
    await expect(element(by.id('list-row-btn-openFeedback-fp-bot'))).toExist();
  });

  // The tap → feedback-mode flow renders the bot's '/help' greeting as a text bubble (no testID
  // yet, and the multi-line string makes by.text brittle) — verified by screenshot instead.
});
