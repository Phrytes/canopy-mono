/**
 * Feedback routing in the v2 kring (the in-kring feedback mount — circleApp's circleFeedbackMount). Verifies,
 * WITHOUT an LLM (the control intents are deterministic):
 *   1. `/feedback`            → enters feedback mode; the bot posts its Dutch guidance ("Zo werkt het").
 *   2. free text while active → routed to the feedback bot (a reply bubble; not "unknown command").
 *   3. `/help`                → reaches the bot (its guidance re-appears).
 *   4. `/bekijk` (review)     → reaches the bot (the renamed /klaar; a reply, no unknown-command).
 *
 * (Migrated off the classic shell 2026-06-29. The v2 feedback PRIMARY surface is the dedicated fp-bot contact
 * thread — covered by the contactThread vitest; this guards the secondary in-kring feedback routing. Classic
 * step 5 — /feedback-stop then /me handled by the "shell" — was dropped: v2 has no separate shell, and identity
 * lives on the Mij screen.)
 */
import { test, expect } from '@playwright/test';
import { bootKring, sendKring, kringBubbles } from './helpers.js';

test.setTimeout(90_000);

const HELP_SUBSTR = 'Zo werkt het';   // start of the feedback bot's /help guidance (nl)

test('in-kring feedback: /feedback → guidance, free text + bot slashes route to the bot', async ({ page }) => {
  await bootKring(page, 'Feedback Circle');

  // 1. /feedback → the feedback bot posts its guidance into the kring.
  await sendKring(page, '/feedback', 3500);
  let bubbles = await kringBubbles(page);
  expect(bubbles.join(' | ')).toContain(HELP_SUBSTR);

  // 2. free text while active → routed to the bot (a reply lands; no unknown-command).
  let before = bubbles.length;
  await sendKring(page, 'het plein is te druk', 2500);
  bubbles = await kringBubbles(page);
  expect(bubbles.length, 'free text while active should add a bot reply').toBeGreaterThan(before);
  expect(bubbles.join(' | ')).not.toMatch(/unknown command|onbekend commando/i);

  // 3. /help (the bot's OWN slash) reaches the bot → its guidance re-appears (≥2 occurrences).
  await sendKring(page, '/help', 2500);
  bubbles = await kringBubbles(page);
  expect(bubbles.join(' | ').split(HELP_SUBSTR).length - 1, '/help re-emits the bot guidance').toBeGreaterThanOrEqual(2);

  // 4. /bekijk (review; renamed from /klaar) reaches the bot — a reply, no unknown-command.
  before = bubbles.length;
  await sendKring(page, '/bekijk', 3500);
  bubbles = await kringBubbles(page);
  expect(bubbles.length, '/bekijk should reach the bot').toBeGreaterThan(before);
  expect(bubbles.join(' | ')).not.toMatch(/unknown command|onbekend commando/i);
});
