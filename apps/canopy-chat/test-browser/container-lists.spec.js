/**
 * Cluster K · K2 — the container UI in the kring: the Lists panel renders a `list` container with its
 * `list-item` children nested (projectContainer→renderContainerCard); "+ add" creates a contained child;
 * a row-action completes it. The composable model, live in the app.
 */
import { test, expect } from '@playwright/test';
import { bootKring } from './helpers.js';

test.setTimeout(70_000);

test('Lists panel: create a list, add a nested item, complete it', async ({ page }) => {
  await bootKring(page, 'Lists Circle');

  // open the kring more-menu → Lists
  await page.locator('.circle-kring__more').click();
  await page.waitForTimeout(400);
  await page.locator('.circle-kring__more-item[data-action="lists"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.cc-lists-panel')).toBeVisible();

  // create a list
  await page.locator('.cc-lists-panel__new-input').fill('groceries');
  await page.locator('.cc-lists-panel__create').click();
  await page.waitForTimeout(300);
  const listRow = page.locator('.cc-lists-panel__list', { hasText: 'groceries' });
  await expect(listRow).toBeVisible();

  // open the list → its container card
  await listRow.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.circle-container-card')).toBeVisible();
  await expect(page.locator('.circle-container-card')).toContainText('groceries');

  // add an item — "+ add" reveals an inline input; fill + submit
  await page.locator('.circle-container-card__add').click();
  await page.locator('.cc-lists-panel__add-input').fill('milk');
  await page.locator('.cc-lists-panel__add-form .cc-lists-panel__create').click();
  await page.waitForTimeout(400);
  const itemRow = page.locator('.circle-container-card__row[data-type="list-item"]');
  await expect(itemRow).toContainText('milk');                       // the child is CONTAINED + rendered nested

  // complete it → the row shows the ✓ prefix
  await itemRow.locator('[data-op="markComplete"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.circle-container-card__row[data-type="list-item"]')).toContainText('✓ milk');
});
