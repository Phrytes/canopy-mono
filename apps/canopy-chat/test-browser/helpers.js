/**
 * Shared Playwright helpers for canopy-chat cross-tab E2E tests.
 *
 * Factored out of mesh-and-dm.spec.js (2026-05-24) so that
 * multi-device-journeys.spec.js can reuse the NKN-bootstrap +
 * typing + selector primitives without copying them.
 *
 * Conventions assumed by every consumer:
 *   - Each browser context = one user (separate IndexedDB +
 *     separate NKN identity).
 *   - The DOM exposes these stable IDs/classes:
 *       #chat-input            — single-line input
 *       #messages              — active thread's message stream
 *       #active-thread-name    — top-of-pane title
 *       #sidebar               — thread list container
 *       .cc-thread-row         — one per thread; data-thread-id="…"
 *       .cc-thread-name        — clickable title within a row
 *       .cc-cmd-suggest-item   — auto-suggest dropdown item
 */
import { expect } from '@playwright/test';

/** Wait until a tab's NKN transport reports connected; resolves to its address. */
export async function waitForNknConnect(page, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const onMsg = (msg) => {
      const text = msg.text();
      const m = text.match(/\[peer\] connected, NKN address:\s*([0-9a-f]+)/);
      if (m) {
        page.off('console', onMsg);
        resolve(m[1]);
      }
    };
    page.on('console', onMsg);
    setTimeout(() => {
      page.off('console', onMsg);
      reject(new Error(`NKN connect timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });
}

/** Type text into the chat input + submit. */
export async function typeCmd(page, text, settleMs = 300) {
  const input = page.locator('#chat-input');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(settleMs);
}

/**
 * Click a sidebar thread row whose visible name CONTAINS `needle`
 * (case-insensitive substring match).  Waits up to `timeoutMs` for
 * the row to appear — useful right after a cross-tab event that
 * spawns a thread.
 */
export async function openThreadByName(page, needle, timeoutMs = 10_000) {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const row = page.locator('.cc-thread-row .cc-thread-name', { hasText: re }).first();
  await expect(row).toBeVisible({ timeout: timeoutMs });
  await row.click();
}

/** Open three tabs, each in its own context; return addresses in order.
 *  Defaults to the classic chat shell (now at /classic.html since the v2
 *  circle app took over the default route). */
export async function bootTabs(browser, n, gotoUrl = '/classic.html') {
  const ctxs  = [];
  const pages = [];
  const addrPromises = [];
  for (let i = 0; i < n; i += 1) {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    ctxs.push(ctx);
    pages.push(page);
    page.on('console', (m) => console.log(`  [tab${i}]`, m.text()));
    addrPromises.push(waitForNknConnect(page));
  }
  await Promise.all(pages.map((p) => p.goto(gotoUrl)));
  const addrs = await Promise.all(addrPromises);
  // NKN multiclient finishes bootstrapping after the first "connected"
  // event fires; first-send often drops without a settle wait.
  await pages[0].waitForTimeout(4_000);
  return { ctxs, pages, addrs };
}

/** Close every context (best-effort, swallows errors so test teardown is clean). */
export async function closeContexts(ctxs) {
  for (const ctx of ctxs) {
    try { await ctx.close(); } catch (_) { /* ignore */ }
  }
}

/** Assert a message bubble containing `needle` appears in #messages within timeoutMs (CLASSIC shell). */
export async function expectBubbleSoon(page, needle, timeoutMs = 45_000) {
  await expect(page.locator('#messages'))
    .toContainText(needle, { timeout: timeoutMs });
}

// ── v2 app helpers (index.html / circleApp) — the migration target ──────────────────────────────────────
// Lifted from the per-spec `openKringComposer` (circle-kring-*.spec.js) so migrated specs share ONE boot.

/** Boot the v2 app and open a kring chat composer. Resolves once `.circle-kring__composer-input` is visible. */
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
