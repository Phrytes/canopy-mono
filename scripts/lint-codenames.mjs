#!/usr/bin/env node
// Fitness guard: no internal PLANNING CODENAMES in public code comments or docs
// (naming-hygiene audit, task #26). Planning codenames (phase labels, cluster
// codes, board numbers, question refs, bare issue refs) are noise to any fresh
// reader — and once caused a real audit miss (circleLists filed under "cluster
// K" made the lists feature look absent). Comments/docs must describe what a
// thing IS, not which planning bucket it came from.
//
// SCOPE + the curated codename patterns live in scripts/codenames-scope.mjs
// (shared with the fitness test). This guard fails (exit 1) on any hit in a
// scoped source comment or doc prose.
//
// Usage:
//   node scripts/lint-codenames.mjs           # lint (exit 1 on any hit)
//   node scripts/lint-codenames.mjs --list    # group hits by pattern id
//   node scripts/lint-codenames.mjs --json     # machine-readable hit list

import { readFileSync } from 'node:fs';
import {
  tracked, isScopedCode, isScopedDoc, isPublicApiDoc, isWave1PkgJson,
  commentMask, docProseMask, pkgDescriptionMask, findCodenames,
} from './codenames-scope.mjs';

const MODE = process.argv.includes('--json') ? 'json'
  : process.argv.includes('--list') ? 'list' : 'lint';

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Pick the mask + findCodenames context for a scoped file (null → out of scope). */
function scopeOf(f) {
  if (isWave1PkgJson(f)) return { mask: pkgDescriptionMask, context: 'api' };
  if (isPublicApiDoc(f)) return { mask: docProseMask, context: 'api' };
  if (isScopedCode(f)) return { mask: commentMask, context: 'code' };
  if (isScopedDoc(f)) return { mask: docProseMask, context: 'doc' };
  return null;
}

const violations = [];
const files = tracked();
for (const f of files) {
  const scope = scopeOf(f);
  if (!scope) continue;
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  for (const hit of findCodenames(scope.mask(src), scope.context)) {
    const line = lineOf(src, hit.index);
    const lineText = src.split('\n')[line - 1] ?? '';
    violations.push({ file: f, line, id: hit.id, match: hit.match, text: lineText.trim().slice(0, 120) });
  }
}

if (MODE === 'json') {
  process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  process.exit(0);
}

if (MODE === 'list') {
  const byId = {};
  for (const v of violations) (byId[v.id] ??= []).push(v);
  for (const id of Object.keys(byId).sort()) {
    console.log(`\n### ${id} — ${byId[id].length} hit(s)`);
    for (const v of byId[id]) console.log(`  ${v.file}:${v.line}  [${v.match}]  ${v.text}`);
  }
  console.log(`\nTOTAL: ${violations.length} hit(s) across ${new Set(violations.map((v) => v.file)).size} file(s).`);
  process.exit(0);
}

if (violations.length) {
  console.error(`\n✖ lint-codenames: ${violations.length} internal codename(s) in scoped comments/docs:`);
  const byFile = {};
  for (const v of violations) (byFile[v.file] ??= []).push(v);
  for (const f of Object.keys(byFile).sort()) {
    console.error(`\n  ${f}`);
    for (const v of byFile[f]) console.error(`    :${v.line}  [${v.id}: ${v.match}]  ${v.text}`);
  }
  console.error(`\nFix: replace the codename with the DESCRIPTIVE meaning (what the thing IS), or drop`);
  console.error(`the codename keeping the sentence intact. Planning buckets belong in plans/, not code.\n`);
  process.exit(1);
}
console.log(`✓ lint-codenames: clean — no internal codenames in scoped comments/docs.`);
