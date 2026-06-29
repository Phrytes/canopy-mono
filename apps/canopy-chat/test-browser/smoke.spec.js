/**
 * Playwright smoke test (v2 app) — verifies the scaffold itself works:
 *   1. The dev server is reachable + the v2 app boots with no page error.
 *   2. The kring (GESPREK) composer renders.
 *   3. A deterministic slash command dispatches and a bot reply bubble lands.
 *
 * (Migrated off the classic shell 2026-06-29 — classic's `/me` identity command has no v2 kring
 * equivalent; identity lives on the Mij screen. The "dispatch → reply" smoke uses `/addtask`, which runs
 * deterministically in the v2 kring.)
 */
import { test, expect } from '@playwright/test';
import { bootKring, sendKring, kringBubbles } from './helpers.js';

test.setTimeout(70_000);

test('v2 app boots clean (no page error)', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForTimeout(4000);
  expect(errs).toEqual([]);
  await expect(page.locator('.circle-screens-picker, .circle-launcher')).toHaveCount(1);
});

test('kring composer dispatches a command → a bot reply bubble lands', async ({ page }) => {
  await bootKring(page, 'Smoke Circle');
  const before = (await kringBubbles(page)).length;
  await sendKring(page, '/addtask smoke-check');
  const bubbles = await kringBubbles(page);
  // the dispatch ran + rendered a reply (more bubbles than before), referencing the new task.
  expect(bubbles.length).toBeGreaterThan(before);
  expect(bubbles.join(' | ').toLowerCase()).toContain('smoke-check');
});
