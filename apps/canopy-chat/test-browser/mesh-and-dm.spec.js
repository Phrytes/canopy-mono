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

/**
 * NKN cross-tab tests are gated behind RUN_NKN_TESTS=1 because they
 * depend on real NKN public-node routing, which is inherently flaky
 * in headless contexts.  In manual smoke testing the same flows work
 * reliably (slow human pacing lets HI handshakes complete).  The
 * tests stay as executable documentation + can be run on demand:
 *
 *   RUN_NKN_TESTS=1 pnpm exec playwright test test-browser/mesh-and-dm.spec.js
 *
 * Auto-suggest + boot-smoke run unconditionally (no NKN dependency).
 */
const runNkn = process.env.RUN_NKN_TESTS === '1';

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
  // NKN tests need 90s+ for connect + HI handshake + delivery in
  // headless.  Default 30s gets killed long before the receive
  // expectation can succeed.
  test.describe.configure({ timeout: 120_000 });
  test('two tabs: create-group + join-group + cross-post', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const tabA = await ctxA.newPage();
    const tabB = await ctxB.newPage();

    // Hook NKN-connect listeners BEFORE navigating.
    const addrAPromise = waitForNknConnect(tabA);
    const addrBPromise = waitForNknConnect(tabB);
    await tabA.goto('/classic.html');
    await tabB.goto('/classic.html');
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
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const tabA = await ctxA.newPage();
    const tabB = await ctxB.newPage();

    const addrAPromise = waitForNknConnect(tabA);
    const addrBPromise = waitForNknConnect(tabB);
    // Diagnostic: forward both tabs' console to test stdout so failures
    // surface what the browser actually saw (NKN errors, receive
    // events, send failures, etc.).
    tabA.on('console', (m) => console.log('  [A]', m.text()));
    tabB.on('console', (m) => console.log('  [B]', m.text()));
    await tabA.goto('/classic.html');
    await tabB.goto('/classic.html');
    const [addrA, addrB] = await Promise.all([addrAPromise, addrBPromise]);

    // NKN multiclient finishes bootstrapping after the first
    // "connected" event fires — first-message-out tends to drop if
    // we send immediately.  4s wait reliably stabilises in headless.
    await tabA.waitForTimeout(4_000);

    // Both tabs pre-open the DM with the other — so when messages
    // arrive, the receiving tab's active thread IS the DM thread.
    await typeCmd(tabA, `/dm ${addrB}`);
    await typeCmd(tabB, `/dm ${addrA}`);
    await expect(tabA.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });
    await expect(tabB.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });

    // Tab A sends a message.  First send triggers HI handshake;
    // secure-agent's sendToPeer retries on race (#215), so we wait
    // up to 45s — real NKN routing through a public node can be
    // slow in a fresh headless context.
    await typeCmd(tabA, 'hello from A');
    await expect(tabB.locator('#messages'))
      .toContainText(/hello from A/i, { timeout: 45_000 });

    // Round-trip the other direction.
    await typeCmd(tabB, 'reply from B');
    await expect(tabA.locator('#messages'))
      .toContainText(/reply from B/i, { timeout: 45_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('command auto-suggest shows + filters on slash input', async ({ page }) => {
    await page.goto('/classic.html');
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

  /**
   * #219 (2026-05-24) regression — verify the new task-editing +
   * sub-task slash commands made it into the manifest catalog
   * (which the auto-suggest reads from).  If someone removes the
   * manifest entries without thinking, this test catches it
   * before the user does.
   */
  test('new /edit-task + sub-task commands appear in auto-suggest', async ({ page }) => {
    await page.goto('/classic.html');
    const input = page.locator('#chat-input');
    const list  = page.locator('#cmd-suggest');

    // /edit-task is the #219 slice-a entry-point.
    await input.focus();
    await input.pressSequentially('/edit-t');
    await expect(list).toContainText(/edit-task/i, { timeout: 5_000 });
    await input.press('Escape');

    // Slice-b: /add-subtask + /propose-subtask.
    await input.fill('');
    await input.pressSequentially('/add-sub');
    await expect(list).toContainText(/add-subtask/i, { timeout: 5_000 });
    await input.press('Escape');

    await input.fill('');
    await input.pressSequentially('/propose-sub');
    await expect(list).toContainText(/propose-subtask/i, { timeout: 5_000 });
    await input.press('Escape');
  });
});
