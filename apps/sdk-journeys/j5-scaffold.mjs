/**
 * J5 — scaffold: generate a runnable app skeleton from a manifest and
 * verify the generated contract.
 *
 * The imagined developer: someone starting a brand-new Onderling app. They
 * have decided on a manifest (the operations their app offers) and the
 * capabilities it needs, and want the boilerplate — package.json, the
 * manifest module, a wired entry point — generated rather than hand-copied
 * from another app.
 *
 * What it proves: `@onderling/app-scaffold` + `@onderling/app-manifest` suffice to
 *   1. validate the capability list up front (an unknown capability is a
 *      coded, no-side-effect failure),
 *   2. scaffold the four-file skeleton purely in memory (`files` map) and,
 *      when wanted, onto disk via the `writer` callback,
 *   3. produce a generated manifest module that round-trips: written to a
 *      temp dir, imported back, and strictly validated with the same
 *      `validateManifest` the platform uses,
 *   4. produce an entry point that only imports `@onderling/sdk` — the
 *      scaffolded app depends on the published facade, nothing internal.
 *
 * Everything here runs offline; the only side effect is a temp directory.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scaffoldApp, APP_SCAFFOLD_CODES } from '@onderling/app-scaffold';
import { validateManifest } from '@onderling/app-manifest';

function step(n, text) { console.log(`  ${n}. ${text}`); }

console.log('J5 scaffold — manifest in, runnable skeleton out, contract verified');

// ── 1. The manifest the new app will be generated from ─────────────────────
const manifest = {
  app:       'greeter',
  itemTypes: ['note'],
  operations: [
    {
      id:        'addGreeting',
      verb:      'add',
      appliesTo: { type: 'note' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { chat: { reply: 'text', hint: 'Record a greeting.' } },
    },
  ],
};
step(1, `authored the input manifest: app "${manifest.app}", ${manifest.operations.length} operation`);

// ── 2. An unknown capability fails fast, with a stable code, no files ──────
assert.throws(
  () => scaffoldApp({ manifest, requires: ['core', 'blockchain'], appId: 'greeter' }),
  (err) => err.code === APP_SCAFFOLD_CODES.INVALID_REQUIRES,
  'unknown capability must throw the coded scaffold error',
);
step(2, `requires validation: unknown capability rejected with code ${APP_SCAFFOLD_CODES.INVALID_REQUIRES}`);

// ── 3. Scaffold for real (in memory first) ──────────────────────────────────
const { files, warnings } = scaffoldApp({
  manifest,
  requires: ['core', 'high'],
  appId:    'greeter',
});
const paths = Object.keys(files).sort();
assert.deepEqual(
  paths,
  ['README.md', 'manifest.js', 'package.json', 'src/index.js'],
  'the v0 skeleton is exactly these four files',
);
step(3, `scaffolded ${paths.length} files in memory: ${paths.join(', ')} (${warnings.length} documented deferral warnings)`);

// ── 4. The generated package depends only on the published facade ──────────
const pkg = JSON.parse(files['package.json']);
assert.equal(pkg.name, '@onderling-app/greeter', 'package is named after the appId');
assert.deepEqual(Object.keys(pkg.dependencies), ['@onderling/sdk'], 'sole runtime dependency is @onderling/sdk');
assert.ok(files['src/index.js'].includes("from '@onderling/sdk"), 'the entry imports from the SDK facade');
assert.ok(!files['src/index.js'].includes('../../packages'), 'no relative reach-ins into the platform repo');
step(4, `generated package "${pkg.name}" depends only on ${Object.keys(pkg.dependencies).join(', ')}`);

// ── 5. Write to a temp dir via the writer callback ──────────────────────────
const dir = await mkdtemp(join(tmpdir(), 'onderling-scaffold-'));
const written = [];
scaffoldApp({
  manifest,
  requires: ['core', 'high'],
  appId:    'greeter',
  writer:   (file) => written.push(file),
});
for (const file of written) {
  const target = join(dir, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content, 'utf8');
}
assert.equal(written.length, 4, 'the writer callback received every file');
step(5, `materialized the skeleton into ${dir}`);

// ── 6. Round-trip: import the generated manifest, validate it strictly ─────
const generated = (await import(pathToFileURL(join(dir, 'manifest.js')).href)).default;
assert.equal(generated.app, 'greeter', 'the generated module exports the manifest');
const check = validateManifest(generated, { strict: true });
assert.equal(check.ok, true,
  `the generated manifest validates strictly (errors: ${JSON.stringify(check.errors)})`);
assert.deepEqual(
  generated.operations.map((op) => op.id),
  manifest.operations.map((op) => op.id),
  'operations survived the round-trip intact',
);
step(6, 'imported the generated manifest.js back and validated it strictly — ok');

await rm(dir, { recursive: true, force: true });
step(7, 'cleaned up the temp directory');

console.log('✓ J5 scaffold: PASS');
