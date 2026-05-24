/**
 * #222 bundle-boot smoke — the lesson from #217's TDZ trap is that
 * Vitest unit-tests pass when handlers import in ISOLATION; bundle-
 * load failures (TDZ, missing exports, polyfill drift) only show up
 * if you actually load the app entry.  This file loads the portable
 * core layer end-to-end so a future ReferenceError in agentBundle
 * fails CI, not Frits's first Android build.
 *
 * Doesn't cover the RN screen layer (vitest can't render RN
 * components) — that's #224A's Playwright/Expo-web job.
 */
import { describe, it, expect } from 'vitest';

import { composeManifests }                from '../src/core/composeManifests.js';
import { buildNavModels }                  from '../src/core/navModel.js';
import { bootAgentBundle }                 from '../src/core/agentBundle.js';
import { t, initLocalisation, setLang }    from '../src/core/localisation.js';

describe('#222 canopy-chat-mobile portable-core boot', () => {
  it('composeManifests merges all 5 apps without validator errors', () => {
    const catalog = composeManifests();
    // All 5 expected apps land in appOrigins (Set).
    const apps = [...catalog.appOrigins];
    expect(apps).toContain('canopy-chat');
    expect(apps).toContain('tasks-v0');
    expect(apps).toContain('stoop');
    expect(apps).toContain('folio');
    expect(apps).toContain('calendar');
    // The merger aliases collisions deterministically (e.g.
    // `startDm` lives on both canopy-chat + stoop, the latter is
    // exposed as `stoop/startDm`).  These benign warnings are
    // fine; any UNEXPECTED warning should fail the test.
    const benign = /op-id collision: "\w+" also declared by/;
    const unexpected = (catalog.warnings ?? []).filter((w) => !benign.test(w));
    expect(unexpected).toEqual([]);
  });

  it('buildNavModels produces one NavModel per app via renderMobile', () => {
    const navs = buildNavModels();
    const apps = navs.map((n) => n.appOrigin);
    // Same five apps, deterministic order matching the bottom-tab
    // layout (canopy-chat first, content apps after).
    expect(apps[0]).toBe('canopy-chat');
    expect(apps).toContain('tasks-v0');
    expect(apps).toContain('stoop');
    expect(apps).toContain('folio');
    expect(apps).toContain('calendar');
    // Every NavModel must be JSON-serialisable (no circular refs).
    for (const { nav } of navs) {
      expect(() => JSON.stringify(nav)).not.toThrow();
      expect(nav.app).toBeTruthy();
    }
  });

  it('bootAgentBundle returns the V0 skeleton skill stub', async () => {
    const bundle = await bootAgentBundle();
    expect(typeof bundle.callSkill).toBe('function');
    const r = await bundle.callSkill('tasks-v0', 'addTask', { text: 'x' });
    // V0: stub returns agent-not-booted; #225.1 + per-agent wiring
    // flips this to a real result.
    expect(r.ok).toBe(false);
    expect(r.error).toBe('agent-not-booted');
    expect(r.note).toMatch(/addTask/);
  });

  it('bootAgentBundle accepts a skillStub override (test-double seam)', async () => {
    const bundle = await bootAgentBundle({
      skillStub: async (opId) => ({ ok: true, mockOp: opId }),
    });
    const r = await bundle.callSkill('stoop', 'postRequest', { text: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.mockOp).toBe('postRequest');
  });

  it('localisation: t() resolves locale keys + falls back to key', async () => {
    await initLocalisation({ lng: 'en' });
    expect(t('app.name')).toBe('canopy-chat');
    expect(t('chat.placeholder')).toMatch(/slash command/i);

    setLang('nl');
    expect(t('chat.placeholder')).toMatch(/slash-commando/i);
    setLang('en');

    expect(t('does.not.exist')).toBe('does.not.exist');
    expect(t('boot.boot_failed', { message: 'boom' })).toMatch(/boom/);
  });
});
