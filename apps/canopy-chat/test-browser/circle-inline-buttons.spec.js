import { test, expect } from '@playwright/test';

// S6.A e2e — manifest-driven inline buttons on a bot reply. The deterministic
// gate ("@assistant add X" → addTask) dispatches a real task op; the reply must
// now carry a `[Claim · X]` inline button (computeEmbedButtons over the tasks
// manifest, appliesTo state:open), and tapping it dispatches claimTask.
test.setTimeout(70000);

async function openKringComposer(page) {
  page.on('dialog', (d) => d.accept('S6A Circle'));
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

async function send(page, text) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(2500);
}

test('adding a task renders an inline Claim button on the bot reply, and it dispatches', async ({ page }) => {
  await openKringComposer(page);

  await send(page, '@assistant add s6abuy');

  // The reply card carries the manifest inline button (appliesTo state:open → Claim).
  const claim = page.locator('.circle-kring__embed-button', { hasText: /claim/i });
  await expect(claim.first()).toBeVisible({ timeout: 8000 });
  await expect(claim.first()).toHaveAttribute('data-op-id', 'claimTask');

  // Tapping it dispatches claimTask against the item → a new bot reply, no error.
  const before = await page.locator('.circle-kring__bubble').count();
  await claim.first().click();
  await page.waitForTimeout(2500);
  const after = await page.locator('.circle-kring__bubble').allTextContents();
  expect(after.length).toBeGreaterThan(before);          // a reply to the claim
  const blob = after.join(' | ').toLowerCase();
  expect(blob).not.toContain('item not found');
  expect(blob).not.toContain('couldn');
});
