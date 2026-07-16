// readme-fitness — the documentation drift guard (docs ↔ code).
//
// For every publishable package README: extract the fenced ```js blocks, find each
// `import { X, Y } from '@onderling/<pkg>[/subpath]'`, dynamically import the REAL package,
// and assert every documented symbol actually exists. A README that names a symbol the code
// doesn't export FAILS here — so published docs cannot drift from the published surface.
//
// This is the automatable core of doc verification. The EXECUTABLE layer is
// apps/sdk-journeys (run-all.mjs) — journeys run real flows; this script pins the NAMED surface.
// Run:  node scripts/readme-fitness.mjs        (exit 1 on any drift)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

// Resolve '@onderling/<pkg>[/<sub>]' through the target package's OWN package.json
// (exports map, then main) — the same resolution a consumer gets, independent of
// where this script runs or which links happen to be hoisted.
async function importOnderling(spec) {
  const m = spec.match(/^@onderling\/([^/]+)(\/.+)?$/);
  if (!m) throw new Error(`not an @onderling specifier: ${spec}`);
  const [, name, subRaw] = m;
  const pkgDir = resolve(ROOT, 'packages', name);
  const pkgJson = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
  const sub = subRaw ? `.${subRaw}` : '.';
  let target = null;
  if (pkgJson.exports) {
    const entry = pkgJson.exports[sub];
    target = typeof entry === 'string' ? entry : entry?.default ?? entry?.import ?? null;
  }
  if (!target && sub === '.') target = pkgJson.main ?? 'index.js';
  if (!target) throw new Error(`no exports entry '${sub}' in @onderling/${name}`);
  return import(pathToFileURL(resolve(pkgDir, target)).href);
}
const WAVE1 = [
  'sdk', 'core', 'transports', 'vault', 'pod-client', 'redaction', 'pseudo-pod',
  'item-types', 'item-store', 'app-manifest', 'app-scaffold', 'attribute-charter',
  'logger', 'oidc-session', 'agent-registry',
];

const jsBlocks = (md) => [...md.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
const imports = (code) => [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@onderling\/[^']+)'/g)]
  .map((m) => ({
    symbols: m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    from: m[2],
  }));

let failures = 0;
for (const pkg of WAVE1) {
  const readmePath = resolve(ROOT, 'packages', pkg, 'README.md');
  if (!existsSync(readmePath)) { console.log(`✗ ${pkg}: NO README`); failures++; continue; }
  const md = readFileSync(readmePath, 'utf8');
  const missing = [];
  for (const block of jsBlocks(md)) {
    for (const { symbols, from } of imports(block)) {
      let mod;
      try { mod = await importOnderling(from); }
      catch (e) { missing.push(`${from} (module failed to load: ${e.message.slice(0, 60)})`); continue; }
      for (const s of symbols) {
        if (!(s in mod)) missing.push(`${s} ← '${from}'`);
      }
    }
  }
  if (missing.length) {
    failures++;
    console.log(`✗ ${pkg}: ${missing.length} documented symbol(s) not exported:`);
    for (const m of missing) console.log(`    ${m}`);
  } else {
    console.log(`✓ ${pkg}`);
  }
}
// ── tutorials + index: same guard over docs/ ────────────────────────────────
import { readdirSync } from 'node:fs';
const DOCS = [
  resolve(ROOT, 'docs', 'packages.md'),
  ...readdirSync(resolve(ROOT, 'docs', 'tutorials')).filter((n) => n.endsWith('.md'))
    .map((n) => resolve(ROOT, 'docs', 'tutorials', n)),
  ...readdirSync(resolve(ROOT, 'docs', 'how-to')).filter((n) => n.endsWith('.md'))
    .map((n) => resolve(ROOT, 'docs', 'how-to', n)),
];
for (const docPath of DOCS) {
  const md = readFileSync(docPath, 'utf8');
  const missing = [];
  for (const block of jsBlocks(md)) {
    for (const { symbols, from } of imports(block)) {
      let mod;
      try { mod = await importOnderling(from); }
      catch (e) { missing.push(`${from} (module failed to load: ${e.message.slice(0, 60)})`); continue; }
      for (const s of symbols) if (!(s in mod)) missing.push(`${s} ← '${from}'`);
    }
  }
  const label = docPath.slice(ROOT.length + 1);
  if (missing.length) {
    failures++;
    console.log(`✗ ${label}: ${missing.length} documented symbol(s) not exported:`);
    for (const m of missing) console.log(`    ${m}`);
  } else console.log(`✓ ${label}`);
}

if (failures) { console.log(`\n${failures} doc(s) drift from the code.`); process.exit(1); }
console.log('\nAll docs match the exported surface.');
