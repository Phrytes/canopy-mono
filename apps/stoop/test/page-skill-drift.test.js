/**
 * Stoop page skill drift canary (2026-05-21).
 *
 * Sibling of `apps/tasks-v0/test/page-skill-drift.test.js`.  Per
 * DESIGN-tier-policy.md, T2/T3 pages may call skills not declared
 * in the manifest, but every skill the page CALLS must actually
 * EXIST.  This catches typos and skill renames before they reach
 * a user.
 *
 * Stoop's skill set is a single `buildSkills` call with a complex
 * bundle dependency.  Rather than stub the bundle, we statically
 * scan `apps/stoop/src/skills/index.js` for `defineSkill('<id>'`
 * patterns — robust enough for this stable skill file (109 skills
 * declared at the time of writing).
 *
 * Scans:
 *   apps/stoop/web/*.html   — every callSkill('<id>') in inline
 *                              `<script type="module">` blocks
 *   apps/stoop/web/app.js   — the page-shared helper module
 *
 * Catches:
 *   - typos (`callSkill('whoAm1')`)
 *   - skill renames where one site was missed
 *   - dead pages still calling deleted skills
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname }            from 'node:path';
import { fileURLToPath }            from 'node:url';

const HERE   = dirname(fileURLToPath(import.meta.url));
const WEBDIR = join(HERE, '..', 'web');
const REPO   = join(HERE, '..', '..', '..');

// All files where stoop's runtime skills are declared via defineSkill.
// Stoop composes its own skills + 3 from @canopy/identity-resolver
// (resolveMember, issueInvite, redeemInvite — via buildIdentitySkills
// + buildOnboardingSkills).  Keep this list in sync when stoop
// composes a new skill substrate.
const SKILL_SOURCES = [
  join(REPO, 'apps', 'stoop', 'src', 'skills', 'index.js'),
  join(REPO, 'packages', 'identity-resolver', 'src', 'skills.js'),
  join(REPO, 'packages', 'identity-resolver', 'src', 'onboardingSkills.js'),
];

// Skills called from pages that legitimately don't live in src/skills/
// index.js.  Each entry MUST cite the reason inline.
const ALLOWLIST = new Set([
  // (No exempted IDs today.  Add per-page as needed with a short
  // comment.  Empty list = "every callSkill ID maps to a real
  // defineSkill in stoop's skill file" — the strongest invariant.)
]);

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** Scan a JS / HTML file for callSkill('<id>') string references. */
function collectIdsFromText(text) {
  const ids = new Set();
  for (const m of text.matchAll(/callSkill\(['"]([A-Za-z_][\w-]*)['"]/g)) {
    ids.add(m[1]);
  }
  return ids;
}

function collectPageSkillIds() {
  const ids = new Set();
  // HTML pages.
  for (const name of readdirSync(WEBDIR)) {
    if (!name.endsWith('.html')) continue;
    const text = stripHtmlComments(readFileSync(join(WEBDIR, name), 'utf8'));
    for (const id of collectIdsFromText(text)) ids.add(id);
  }
  // Shared helper module — also a page-side caller surface.
  const appJs = join(WEBDIR, 'app.js');
  const appText = readFileSync(appJs, 'utf8');
  for (const id of collectIdsFromText(appText)) ids.add(id);
  return ids;
}

function collectRealSkillIds() {
  const ids = new Set();
  for (const src of SKILL_SOURCES) {
    const text = readFileSync(src, 'utf8');
    for (const m of text.matchAll(/defineSkill\(['"]([A-Za-z_][\w-]*)['"]/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

describe('stoop page skill drift canary', () => {
  it('every callSkill(<id>) in web/*.html + web/app.js maps to a real defineSkill', () => {
    const pageIds = collectPageSkillIds();
    const real    = collectRealSkillIds();

    const orphans = [...pageIds].filter((id) => !real.has(id) && !ALLOWLIST.has(id)).sort();

    expect(
      orphans,
      `stoop pages call skill IDs that are not defined in src/skills/index.js:\n` +
        `  ${orphans.join('\n  ')}\n\n` +
        `Fix by:\n` +
        `  (a) correcting the typo in the page, OR\n` +
        `  (b) adding the skill via defineSkill, OR\n` +
        `  (c) if the call is intentionally to a non-skill, add the\n` +
        `      id to ALLOWLIST in this test with a comment.\n`,
    ).toEqual([]);
  });

  it('reports the size of both sets (sanity check — non-empty)', () => {
    const pageIds = collectPageSkillIds();
    const real    = collectRealSkillIds();
    expect(pageIds.size, 'should find at least some callSkill calls').toBeGreaterThan(0);
    expect(real.size,    'should find at least some defineSkill declarations').toBeGreaterThan(100);
  });
});
