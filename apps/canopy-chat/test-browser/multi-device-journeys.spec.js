/**
 * #218 (2026-05-24) — More Playwright multi-device journeys.
 *
 * Five scenarios extending the post→reply→accept→chat arc that
 * #216's mesh-and-dm.spec.js opened up.  Each test corresponds
 * to a real cross-tab flow users hit in the wild:
 *
 *   1. Mesh post fan-out — one tab posts in a buurt thread, the
 *      other tabs see it within mesh-propagation latency.
 *   2. Catch-up on reconnect — B is offline while A posts; on
 *      re-open B fetches the backlog via /catch-up.
 *   3. Calendar invite RSVP — A sends a calendar invite, B
 *      accepts; both see the RSVP in their event list.
 *   4. Embed-card cross-tab — A embeds a task in a DM, B sees
 *      the embed-card render with action buttons.
 *   5. Post→reply→accept→chat full arc — the canonical end-to-
 *      end demo: post in buurt → [Help with] spawns DM → respond
 *      with offer → [Accept] → free-text chat in the same DM.
 *
 * NKN tests are gated behind RUN_NKN_TESTS=1 since they depend
 * on real-network NKN routing (flaky in headless).  Manual
 * smoke-pacing in the browser exercises the same flows reliably.
 *
 * Run with:
 *   RUN_NKN_TESTS=1 pnpm exec playwright test \
 *     test-browser/multi-device-journeys.spec.js
 *
 * Several scenarios are marked test.fixme — they need DOM
 * helpers for create-group / join-group / calendar wizards that
 * don't exist yet.  The fixmes act as executable TODOs: the
 * test body documents what we WANT to assert, but the helper
 * library isn't quite there yet.  See helpers.js.
 */
import { test, expect } from '@playwright/test';

import {
  bootTabs,
  closeContexts,
  expectBubbleSoon,
  openThreadByName,
  typeCmd,
} from './helpers.js';

const runNkn = process.env.RUN_NKN_TESTS === '1';

test.describe('#218 — multi-device journeys', () => {
  // Cross-tab flows reliably need 90s+ for connect + HI + delivery.
  test.describe.configure({ timeout: 180_000 });

  test('mesh post fan-out: 3 tabs share a buurt; A posts → B + C see it', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    test.fixme(true, 'Needs DOM helper for /create-group + /join-group wizards (see #218 follow-up)');

    const { ctxs, pages, addrs } = await bootTabs(browser, 3);
    const [a, b, c] = pages;
    expect(addrs).toHaveLength(3);
    expect(new Set(addrs).size).toBe(3);

    // TODO: walk A through /create-group wizard, capture invite,
    // then drive B + C through /redeem-invite using the invite.
    // Both should land in the same buurt thread.

    // Once everyone is in the buurt:
    //   await openThreadByName(a, 'buurt');
    //   await typeCmd(a, '/post Anyone got a ladder?');
    //   await openThreadByName(b, 'buurt');
    //   await expectBubbleSoon(b, 'Anyone got a ladder');
    //   await openThreadByName(c, 'buurt');
    //   await expectBubbleSoon(c, 'Anyone got a ladder');

    await closeContexts(ctxs);
  });

  test('catch-up on reconnect: B re-opens after A posts → B backfills', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    test.fixme(true, 'Needs persistent IndexedDB across context reopen (see #218 follow-up)');

    const { ctxs, pages, addrs } = await bootTabs(browser, 2);
    const [a, b] = pages;
    expect(addrs[0]).not.toBe(addrs[1]);

    // TODO: A + B in same buurt; B closes its tab (storageState
    // preserved across re-open); A posts twice; B re-opens; B
    // sees both posts via the catch-up backfill path (slice 5).

    await closeContexts(ctxs);
  });

  test('embed-card cross-tab: A embeds task in DM → B sees card + can [Claim]', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    test.fixme(true, 'Needs DOM helper for /embed picker + [Claim] embed-button (see #218 follow-up)');

    const { ctxs, pages, addrs } = await bootTabs(browser, 2);
    const [a, b] = pages;
    const [addrA, addrB] = addrs;

    // Both pre-open the DM with the other (so cross-tab arrivals
    // land in the right thread).
    await typeCmd(a, `/dm ${addrB}`);
    await typeCmd(b, `/dm ${addrA}`);
    await expect(a.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });
    await expect(b.locator('#active-thread-name')).toContainText(/DM/i, { timeout: 5_000 });

    // TODO: A runs /addtask, then /embed <taskId>; B should see
    // the embed-card with a [Claim] button (manifest auto-render
    // via appliesTo: {type:'task', state:['open']}).  Clicking
    // [Claim] on B fires claimTask cross-tab via DM channel.

    await closeContexts(ctxs);
  });

  test('calendar invite RSVP: A sends invite → B accepts → both see RSVP', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    test.fixme(true, 'Needs DOM helper for /invite + [RSVP] embed-button (see #218 follow-up)');

    const { ctxs, pages, addrs } = await bootTabs(browser, 2);
    const [a, b] = pages;
    const [addrA, addrB] = addrs;

    // TODO: A: /invite <addrB> --when=...  → produces an embed-
    // card with [Accept]/[Decline] buttons in a DM thread on B.
    // B clicks [Accept]; A's calendar shows the RSVP'd entry.

    await closeContexts(ctxs);
  });

  test('full arc: post → [Help with] → DM → [Accept] → free-text chat', async ({ browser }) => {
    test.skip(!runNkn, 'NKN cross-tab tests gated; set RUN_NKN_TESTS=1 to enable');
    test.fixme(true, 'Composite of fan-out + embed + DM helpers — depends on the four above');

    const { ctxs, pages } = await bootTabs(browser, 2);
    const [a, b] = pages;

    // TODO: end-to-end thread:
    //   1. A + B both in shared buurt (via fan-out helpers)
    //   2. A /post Anyone got a ladder?
    //   3. B sees post, clicks [Help with] → spawns DM on B's side
    //   4. B writes offer in the DM → A's DM gets the message
    //   5. A clicks [Accept] on the responder card → DM stays alive
    //   6. A + B trade free-text chat messages in the same DM

    await closeContexts(ctxs);
  });
});
