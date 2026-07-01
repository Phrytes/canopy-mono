#!/usr/bin/env node
// Fitness function for the task #66 file-org model (see plans/PLAN-file-org-inventory.md).
// Keeps the docs-vs-code split self-enforcing so the "mess" can't silently recur.
//
// HARD FAILS (exit 1):
//   1. Any file tracked under an ignored private tree (plans/ or _archive/).
//   2. Any TRACKED markdown file whose link target points into a private/ignored area
//      (plans/, _archive/, ../canopy projectfiles, REMAINING-WORK.md, PROGRESS.md, or a
//      root private-prefix doc) — such links break on a fresh public clone.
// WARN (exit 0): tracked root docs matching a private prefix that ought to be `git rm --cached`.
//
// Usage: node scripts/lint-doc-refs.mjs   (or: npm run lint:docs)

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const tracked = sh('git ls-files').split('\n').filter(Boolean);

const PRIVATE_TREE = /^(plans|_archive)\//;
const PRIVATE_PREFIX = /^(PLAN|DESIGN|CODING|VOORSTEL|PROPOSAL|NOTE|WIP|BRIEF)-.*\.md$|^(REMAINING-WORK|PROGRESS)\.md$/;
// link targets that won't resolve for a fresh clone (ignored or outside the repo):
const BAD_TARGET = /(^|\/)(plans|_archive)\/|canopy projectfiles|(^|\/)(REMAINING-WORK|PROGRESS)\.md/;
const MD_LINK = /\]\(([^)]+)\)/g;

const hard = [];
const warn = [];

// 1. private trees must never be tracked
for (const f of tracked) if (PRIVATE_TREE.test(f)) hard.push(`tracked file inside a private tree: ${f}`);

// 2. tracked markdown must not link into private/ignored areas
for (const f of tracked) {
  if (!f.endsWith('.md')) continue;
  if (PRIVATE_TREE.test(f)) continue;
  let body;
  try { body = readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of body.matchAll(MD_LINK)) {
    const target = m[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    if (BAD_TARGET.test(target)) hard.push(`${f}: link to private/ignored path -> ${target}`);
  }
}

// 3. root private-prefix docs that are still tracked (to untrack)
for (const f of tracked) if (!f.includes('/') && PRIVATE_PREFIX.test(f)) warn.push(f);

if (warn.length) {
  console.log(`\n⚠  ${warn.length} tracked root doc(s) match a private prefix — untrack to make private:`);
  for (const f of warn) console.log(`     git rm --cached "${f}"`);
}
if (hard.length) {
  console.error(`\n✖ lint-doc-refs: ${hard.length} violation(s):`);
  for (const h of hard) console.error(`   - ${h}`);
  console.error('\nFix: move the file into docs/ (public) or repoint the link to an in-repo public path.\n');
  process.exit(1);
}
console.log(`✓ lint-doc-refs: clean (${tracked.length} tracked files scanned).`);
