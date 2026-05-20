/**
 * stoop-web smoke — Slice E.1 (PLAN-gui-chat-uplift.md).
 *
 * First stoop web page consuming `renderWeb(stoopManifest)`.  Boots
 * the `apps/stoop/bin/stoop-web.js` bootstrap programmatically, then
 * verifies:
 *   1. `/navmodel.json` is served + carries the `mine` section
 *      (the ONE section E.1 surfaces — see manifest.js's view note).
 *   2. `/stoop-config.json` carries the actor + group.
 *   3. `/mine.html` is served + has the `data-navmodel-section="mine"`
 *      marker that proves the migrated page picks up the section.
 *   4. The skill-dispatch path round-trips: `postRequest` then
 *      `listMyRequests` returns the freshly-added item filtered by
 *      LocalUiAuth-configured actor.
 *
 * Pattern mirrors `apps/household/test/web.test.js` — same shape
 * (programmatic startStoopWeb, same /tasks/send dispatch, same
 * LocalUiAuth-configured actor).  Note the existing `test/web.test.js`
 * still covers the legacy `stoop-ui.js`-style mount (production
 * launcher) — these two tests are complementary, not duplicate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startStoopWeb } from '../bin/stoop-web.js';

const ACTOR = 'https://id.example/anne';
const GROUP = 'block-42';

let handle, baseUrl;

beforeAll(async () => {
  handle  = await startStoopWeb({ port: 0, actor: ACTOR, group: GROUP });
  baseUrl = handle.url;
});

afterAll(async () => {
  await handle?.stop();
});

async function callSkill(skillId, data) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data }] } }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('completed');
  return (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart')?.data ?? {};
}

describe('stoop-web smoke (Slice E.1)', () => {
  it('serves /navmodel.json with the `mine` section', async () => {
    const res = await fetch(`${baseUrl}/navmodel.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const nav = await res.json();
    expect(nav.app).toBe('stoop');
    // E.1 ships ONE section.  Follow-on E.x slices will grow this.
    expect(nav.sections.map((s) => s.id)).toEqual(['mine']);
    const mine = nav.sections[0];
    expect(mine.id).toBe('mine');
    expect(mine.title).toBe('My posts');
    expect(mine.itemType).toBe('request');
    expect(mine.filter).toEqual({ open: true });
    // V0.2 Q7 — explicit dataSource declaration in the manifest.
    expect(mine.dataSource).toEqual({ skillId: 'listMyRequests' });
    // V0.2 Q8 — cancelRequest with `appliesTo: {type: '*'}` surfaces
    // as an itemAction in EVERY section (renderWeb's wildcard rule).
    const cancel = (mine.itemActions ?? []).find((a) => a.opId === 'cancelRequest');
    expect(cancel).toBeDefined();
    expect(cancel.appliesTo.type).toBe('*');
  });

  it('serves /stoop-config.json with the actor + group', async () => {
    const res = await fetch(`${baseUrl}/stoop-config.json`);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.actor).toBe(ACTOR);
    expect(cfg.group).toBe(GROUP);
    expect(cfg.app).toBe('stoop');
  });

  it('serves /mine.html with the data-navmodel-section marker', async () => {
    const res = await fetch(`${baseUrl}/mine.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(0);
    // The marker that proves the migrated page picks up the section.
    expect(html).toContain('data-navmodel-section="mine"');
    // The migrated page still fetches /navmodel.json (the consumption
    // hook).
    expect(html).toContain("fetch('/navmodel.json')");
    // V0.2-adopt (2026-05-21) — the page now drives its data-fetch
    // via the shared `fetchSectionItems` helper (which honours the
    // manifest's `section.dataSource: {skillId: 'listMyRequests'}`
    // Q7 declaration), removing the prior hard-coded skill call.
    expect(html).toContain('fetchSectionItems');
    // Per-row buttons come from `section.itemActions[]` gated by
    // `itemMatchesAppliesTo` (with a local wildcard work-around).
    expect(html).toContain('itemMatchesAppliesTo');
  });

  it('serves /lib/web-adapter/fetchSectionItems.js (V0.2 helper overlay)', async () => {
    // The V0.2 helpers are overlaid by `bin/stoop-web.js`'s
    // `extraStaticFiles` so `mine.html` can `import` them at runtime
    // (same mechanism tasks-v0 uses).
    const res = await fetch(`${baseUrl}/lib/web-adapter/fetchSectionItems.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('export async function fetchSectionItems');
  });

  it('serves /lib/web-adapter/itemMatchesAppliesTo.js (V0.2 helper overlay)', async () => {
    const res = await fetch(`${baseUrl}/lib/web-adapter/itemMatchesAppliesTo.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('export function itemMatchesAppliesTo');
  });

  it('serves /index.html (legacy hand-built page still works)', async () => {
    // Slice E.1 only migrates mine.html — the other 15 pages stay
    // hand-built and serve fine.  Pinning this regression-catches a
    // misconfigured staticDir that broke the non-migrated pages.
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Stoop');
  });

  it('exposes the agent card at /.well-known/agent.json', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('postRequest → listMyRequests round-trips via LocalUiAuth', async () => {
    // Post as ANNE (the LocalUiAuth-configured actor); listMyRequests
    // filters by addedBy=from, so ANNE should see her own item.
    const posted = await callSkill('postRequest', {
      text:         'borrow a ladder',
      intent:       'ask',
      timeoutMs:    1,
      expectClaims: 0,
    });
    expect(posted.requestId).toBeTruthy();

    const mine = await callSkill('listMyRequests', {});
    expect(Array.isArray(mine.items)).toBe(true);
    expect(mine.items.length).toBeGreaterThanOrEqual(1);
    expect(mine.items.some((i) => i.id === posted.requestId)).toBe(true);
    // All returned items belong to the calling actor.
    for (const item of mine.items) {
      expect(item.addedBy).toBe(ACTOR);
    }
  });
});
