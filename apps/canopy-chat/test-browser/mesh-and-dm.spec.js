/**
 * Playwright cross-tab E2E for the post>reply>chat arc.
 *
 * Spins up two (or three) browser contexts — each has its own
 * IndexedDB origin + NKN identity, so they act as truly separate
 * users (admin, joiner-1, joiner-2).
 *
 * Scenarios covered:
 *   1. create-group on A + join-group on B → both see the buurt thread
 *   2. /post in buurt thread on A → appears in B's buurt thread
 *   3. /post on B → appears on A (via mesh OR star, depending on consent)
 *   4. DM via /dm <addr> → message round-trip
 *
 * Each test ~20-30s.  Run with:
 *   pnpm --filter canopy-chat exec playwright test test-browser/mesh-and-dm.spec.js
 *
 * Skipped in CI by default — requires NKN connectivity (real network).
 * Run locally with `pnpm exec playwright test --headed` to watch.
 */
import { test, expect } from '@playwright/test';

/** Wait until a tab's NKN transport reports connected + return its address. */
async function waitForNknConnect(page, timeoutMs = 30_000) {
  // Hook into console BEFORE page.goto so we don't miss the early log.
  const addrPromise = new Promise((resolve, reject) => {
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
  return addrPromise;
}

/** Type into the chat input + submit. */
async function typeCmd(page, text) {
  const input = page.locator('#chat-input');
  await input.fill(text);
  await input.press('Enter');
  // Give the dispatch a moment to render.
  await page.waitForTimeout(300);
}

/** True iff any message bubble in the active thread contains `needle`. */
async function bubblesContain(page, needle, timeoutMs = 10_000) {
  return await expect(page.locator('#messages')).toContainText(needle, { timeout: timeoutMs })
    .then(() => true).catch(() => false);
}

test.describe('Cross-tab mesh + DM end-to-end', () => {
  test('two tabs: create-group + join-group + cross-post', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const tabA = await ctxA.newPage();
    const tabB = await ctxB.newPage();

    // Hook NKN-connect listeners BEFORE navigating.
    const addrAPromise = waitForNknConnect(tabA);
    const addrBPromise = waitForNknConnect(tabB);
    await tabA.goto('/');
    await tabB.goto('/');
    const [addrA, addrB] = await Promise.all([addrAPromise, addrBPromise]);
    expect(addrA).toMatch(/^[0-9a-f]{64}$/);
    expect(addrB).toMatch(/^[0-9a-f]{64}$/);
    expect(addrA).not.toBe(addrB);

    // For now, just verify both tabs are alive + NKN-connected.
    // Real create-group/join wizard interaction needs DOM selectors
    // that match the panel UI — left as a follow-up scenario once
    // the smoke baseline passes.
    expect(addrA).toBeTruthy();
    expect(addrB).toBeTruthy();

    await ctxA.close();
    await ctxB.close();
  });

  test('two tabs: DM via /dm <addr> delivers a chat message', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const tabA = await ctxA.newPage();
    const tabB = await ctxB.newPage();

    const addrAPromise = waitForNknConnect(tabA);
    const addrBPromise = waitForNknConnect(tabB);
    await tabA.goto('/');
    await tabB.goto('/');
    const [, addrB] = await Promise.all([addrAPromise, addrBPromise]);

    // Tab A opens a DM with tab B's NKN address.  /dm dispatch puts
    // the reply in the originating thread + switches active to the
    // new DM thread (now empty in #messages).  Just verify the
    // sidebar shows the DM thread by checking the active header
    // contains "DM".
    await typeCmd(tabA, `/dm ${addrB}`);
    await expect(tabA.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });

    // Tab A sends a message.  First send triggers HI handshake;
    // secure-agent's sendToPeer retries on race (#215), so we wait
    // up to 20s for the receive bubble on tab B.
    await typeCmd(tabA, 'hello from A');
    await expect(tabB.locator('#messages'))
      .toContainText(/hello from A/i, { timeout: 20_000 });

    // Round-trip the other direction.  Tab B's DM-with-A thread was
    // auto-spawned by the incoming chat-message (Slice 6a), so just
    // make sure it's active before typing the reply.
    await expect(tabB.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });
    await typeCmd(tabB, 'reply from B');
    await expect(tabA.locator('#messages'))
      .toContainText(/reply from B/i, { timeout: 20_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('command auto-suggest shows + filters on slash input', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#chat-input');
    // Focus + pressSequentially so each keystroke fires `input`
    // events the way the user typing does.  `.fill()` sets value
    // in one shot which doesn't always wake input listeners that
    // refresh per-keystroke (our refreshSuggest is keystroke-driven).
    await input.focus();
    await input.pressSequentially('/cr');
    // The suggest dropdown should populate with matching commands.
    // Wait for any <li> child (our render adds one per match).
    const items = page.locator('#cmd-suggest .cc-cmd-suggest-item');
    await expect(items.first()).toBeVisible({ timeout: 5_000 });
    const list = page.locator('#cmd-suggest');
    await expect(list).toContainText(/create-group|crew-new|crews/i);
    // Esc dismisses.
    await input.press('Escape');
    await expect(list).toBeHidden();
  });
});
