/**
 * Shared Playwright helpers for the basis v2 app (index.html / circleApp).
 *
 * (The classic-shell + NKN cross-tab primitives — bootTabs/typeCmd/openThreadByName/waitForNknConnect/
 * expectBubbleSoon — were removed 2026-06-29 when the browser suite migrated off classic.html: their only
 * consumers (mesh-and-dm, multi-device-journeys) were retired, the NKN-cross-tab/DM flows having no v2 surface.)
 *
 * v2 DOM conventions: kring composer `.circle-kring__composer-input` / `.circle-kring__composer-send`,
 * bubbles `.circle-kring__bubble`, launcher `.circle-tile` / `.circle-launcher__new`, kringen tab
 * `[data-tab="kringen"]`, chat toggle `.circle-kring__view-toggle-btn`.
 */
import { expect } from '@playwright/test';

/** Boot the v2 app and open a kring chat composer. Resolves once `.circle-kring__composer-input` is visible.
 *  Lifted from the per-spec `openKringComposer` (circle-kring-*.spec.js) so migrated specs share ONE boot. */
export async function bootKring(page, circleName = 'Test Circle') {
  page.on('dialog', (d) => d.accept(circleName));   // "+ new circle" name prompt
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.locator('[data-tab="kringen"]').click();
  await page.waitForTimeout(1500);
  if (await page.locator('.circle-tile').count() === 0) {
    await page.locator('.circle-launcher__new').click();
    await page.waitForTimeout(5000);
  }
  await page.locator('.circle-tile').first().click();
  await page.waitForTimeout(2500);
  await page.locator('.circle-kring__view-toggle-btn', { hasText: 'Chat' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.circle-kring__composer-input')).toBeVisible();
}

/** Send a kring composer line (explicit send button — no Enter/Escape dropdown dance). */
export async function sendKring(page, text, settleMs = 2500) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(settleMs);
}

/** All kring bubble texts (the v2 equivalent of reading #messages). */
export async function kringBubbles(page) {
  return page.locator('.circle-kring__bubble').allTextContents();
}
