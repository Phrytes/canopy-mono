/**
 * Phase 10 — i18n + archive + pause + privacy notice tests.
 *
 * Covers:
 *   1. i18n wrapper — initI18n loads en + nl; t() unwraps `{text, doc}`
 *      leaves; missing keys fall back to the key.
 *   2. PRIVACY_NOTICE shape — same item count + headings in both langs.
 *   3. crewControls skills — pause/unpause/archive/unarchive (admin /
 *      coord gating) + getPrivacyNotice.
 *   4. addTask gate — paused crew rejects with `error: 'crew-paused'`;
 *      archived crew rejects with `error: 'crew-archived'`; resuming
 *      restores the path.
 *   5. Locale loader — every value matches the project's `{text, doc}`
 *      shape. (Convention check.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DataPart } from '@canopy/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';
import { initI18n, t, setLang, currentLang, __test__ } from '../src/lib/i18n.js';
import { PRIVACY_NOTICE, privacyNoticeFor } from '../src/lib/privacyNotice.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  crewId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Pure i18n + privacy-notice tests ───────────────────────────────────────

describe('Phase 10 — i18n wrapper', () => {
  it('initI18n + t() returns the en text', async () => {
    await initI18n({ lng: 'en' });
    expect(t('common.save')).toBe('Save');
    expect(t('actions.claim')).toBe('Claim');
    expect(t('status.submitted')).toBe('submitted');
  });

  it('switching to nl returns Dutch copy', async () => {
    await setLang('nl');
    expect(currentLang()).toBe('nl');
    expect(t('common.save')).toBe('Opslaan');
    expect(t('actions.claim')).toBe('Oppakken');
    expect(t('nav.workspace')).toBe('Werkbord');
    await setLang('en');
  });

  it('unknown keys fall back to the key string', async () => {
    await setLang('en');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('unwrapLeaves transforms {text, doc} pairs', () => {
    const out = __test__.unwrapLeaves({
      a: { text: 'hello', doc: 'greeting' },
      b: { nested: { text: 'world', doc: 'noun' } },
      c: 'plain string',
    });
    expect(out).toEqual({
      a: 'hello',
      b: { nested: 'world' },
      c: 'plain string',
    });
  });

  it('interpolates {{params}} when supplied', async () => {
    await setLang('en');
    expect(t('compose.result_added', { id: '01ABC' })).toBe('Added: 01ABC');
    await setLang('nl');
    expect(t('compose.result_added', { id: '01ABC' })).toBe('Toegevoegd: 01ABC');
    await setLang('en');
  });
});

describe('Phase 10 — locale files conform to {text, doc} convention', () => {
  function flatLeaves(node, path = []) {
    const out = [];
    if (node === null || typeof node !== 'object') {
      out.push({ path: path.join('.'), node });
      return out;
    }
    if (typeof node.text === 'string'
        && (node.doc === undefined || typeof node.doc === 'string')
        && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
      out.push({ path: path.join('.'), node });
      return out;
    }
    for (const [k, v] of Object.entries(node)) out.push(...flatLeaves(v, [...path, k]));
    return out;
  }

  it('every leaf in en.json is a {text, doc} pair (convention requires both)', async () => {
    const raw = await readFile(join(__dirname, '..', 'locales', 'en.json'), 'utf8');
    const json = JSON.parse(raw);
    const leaves = flatLeaves(json);
    expect(leaves.length).toBeGreaterThan(20); // sanity
    for (const { path: p, node } of leaves) {
      expect(typeof node).toBe('object');
      expect(typeof node.text).toBe('string');
      expect(node.text.length).toBeGreaterThan(0);
      expect(typeof node.doc).toBe('string');
      expect(node.doc.length).toBeGreaterThan(0);
    }
  });

  it('en + nl have the same key set', async () => {
    const en = JSON.parse(await readFile(join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
    const nl = JSON.parse(await readFile(join(__dirname, '..', 'locales', 'nl.json'), 'utf8'));
    const enKeys = flatLeaves(en).map((l) => l.path).sort();
    const nlKeys = flatLeaves(nl).map((l) => l.path).sort();
    expect(nlKeys).toEqual(enKeys);
  });
});

describe('Phase 10 — privacy notice', () => {
  it('has the same number of items in nl + en', () => {
    expect(PRIVACY_NOTICE.nl.length).toBe(PRIVACY_NOTICE.en.length);
    expect(PRIVACY_NOTICE.en.length).toBeGreaterThanOrEqual(6);
  });

  it('every item has heading + body', () => {
    for (const lang of ['nl', 'en']) {
      for (const item of PRIVACY_NOTICE[lang]) {
        expect(typeof item.heading).toBe('string');
        expect(item.heading.length).toBeGreaterThan(0);
        expect(typeof item.body).toBe('string');
        expect(item.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('mentions the calendar-stays-on-device guarantee in both langs', () => {
    const enJoined = PRIVACY_NOTICE.en.map((i) => i.body).join('\n');
    const nlJoined = PRIVACY_NOTICE.nl.map((i) => i.body).join('\n');
    expect(enJoined).toMatch(/calendar/i);
    expect(nlJoined).toMatch(/agenda/i);
  });

  it('privacyNoticeFor falls back to en for unknown langs', () => {
    expect(privacyNoticeFor('xx')).toBe(PRIVACY_NOTICE.en);
  });
});

// ── Live skill tests ───────────────────────────────────────────────────────

describe('Phase 10 — crewControls + addTask gate', () => {
  let lsBundle;
  let crew;

  beforeEach(async () => {
    lsBundle = buildBundle();
    crew = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    await crew?.close?.();
  });

  it('pauseCrew sets crew.paused; addTask blocked; unpauseCrew restores', async () => {
    const before = await callSkill(crew.agent, 'addTask', { text: 'Pre-pause' }, ANNE);
    expect(before.task?.id).toBeTruthy();

    const p = await callSkill(crew.agent, 'pauseCrew', {}, ANNE);
    expect(p.ok).toBe(true);
    expect(p.paused).toBe(true);

    const blocked = await callSkill(crew.agent, 'addTask', { text: 'During pause' }, ANNE);
    expect(blocked.error).toBe('crew-paused');

    // Existing tasks remain claimable / completable.
    const claim = await callSkill(crew.agent, 'claimTask', { id: before.task.id }, KID);
    expect(claim.result?.assignee).toBe(KID);

    // Unpause restores addTask.
    const u = await callSkill(crew.agent, 'unpauseCrew', {}, ANNE);
    expect(u.paused).toBe(false);
    const after = await callSkill(crew.agent, 'addTask', { text: 'Post-pause' }, ANNE);
    expect(after.task?.id).toBeTruthy();
  });

  it('archiveCrew blocks addTask; unarchive restores', async () => {
    const ar = await callSkill(crew.agent, 'archiveCrew', {}, ANNE);
    expect(ar.archived).toBe(true);
    const blocked = await callSkill(crew.agent, 'addTask', { text: 'Hi' }, ANNE);
    expect(blocked.error).toBe('crew-archived');
    const ua = await callSkill(crew.agent, 'unarchiveCrew', {}, ANNE);
    expect(ua.archived).toBe(false);
    const after = await callSkill(crew.agent, 'addTask', { text: 'Hi again' }, ANNE);
    expect(after.task?.id).toBeTruthy();
  });

  it('archive precedence: archived takes priority over paused in the error code', async () => {
    await callSkill(crew.agent, 'pauseCrew', {}, ANNE);
    await callSkill(crew.agent, 'archiveCrew', {}, ANNE);
    const r = await callSkill(crew.agent, 'addTask', { text: 'Hi' }, ANNE);
    expect(r.error).toBe('crew-archived');
  });

  it('non-admin cannot pause / unpause / archive / unarchive', async () => {
    expect((await callSkill(crew.agent, 'pauseCrew',     {}, KID)).error).toMatch(/admin|coord/i);
    expect((await callSkill(crew.agent, 'archiveCrew',   {}, KID)).error).toMatch(/admin/i);
    expect((await callSkill(crew.agent, 'unarchiveCrew', {}, KID)).error).toMatch(/admin/i);
    // coordinator CAN pause but NOT archive.
    expect((await callSkill(crew.agent, 'pauseCrew',   {}, FRITS)).ok).toBe(true);
    expect((await callSkill(crew.agent, 'archiveCrew', {}, FRITS)).error).toMatch(/admin/i);
  });

  it('getPrivacyNotice returns localised content', async () => {
    const en = await callSkill(crew.agent, 'getPrivacyNotice', { lang: 'en' }, ANNE);
    expect(en.lang).toBe('en');
    expect(en.items.length).toBeGreaterThanOrEqual(6);
    expect(en.items[0].heading).toBeTruthy();
    expect(en.items[0].body).toMatch(/encrypted/i);

    const nl = await callSkill(crew.agent, 'getPrivacyNotice', { lang: 'nl' }, ANNE);
    expect(nl.lang).toBe('nl');
    expect(nl.items.length).toBe(en.items.length);
    expect(nl.items[0].body).toMatch(/versleuteld/i);

    // Unknown lang falls back to en.
    const xx = await callSkill(crew.agent, 'getPrivacyNotice', { lang: 'xx' }, ANNE);
    expect(xx.items).toEqual(en.items);
  });

  it('getCrewConfig surfaces the paused / archived flags', async () => {
    await callSkill(crew.agent, 'pauseCrew', {}, ANNE);
    const c = await callSkill(crew.agent, 'getCrewConfig');
    expect(c.crew.paused).toBe(true);
    expect(c.crew.archived).toBe(false);
  });
});
