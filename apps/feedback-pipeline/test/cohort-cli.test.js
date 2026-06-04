// Integration test for the cohort CLI: create-project → generate-codes → status,
// against a temp file-backed store. Exercises the actual CLI process.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../scripts/cohort-cli.js', import.meta.url));
const run = (args, cwd) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });

test('cohort CLI: create-project → generate-codes → status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cohort-'));
  try {
    const cfg = join(dir, 'config.json');
    const store = join(dir, 'store.json');
    writeFileSync(cfg, JSON.stringify({
      projectId: 'cli-proj', llm: { route: 'local', model: 'm' }, aggregation: { k: 3 },
    }));

    const created = run(['create-project', '--config', cfg, '--expires', '2026-12-31T00:00:00Z', '--ceiling', '50', '--store', store], dir);
    assert.match(created, /created cohort for "cli-proj"/);

    const codesOut = run(['generate-codes', '--project', 'cli-proj', '--count', '5', '--store', store], dir);
    const codes = codesOut.trim().split('\n').filter(Boolean);
    assert.equal(codes.length, 5);
    assert.ok(codes.every((c) => /^[0-9a-f]{16}-[0-9a-f]{12}$/.test(c)), 'codes are well-formed');

    const status = run(['status', '--project', 'cli-proj', '--store', store], dir);
    assert.match(status, /cli-proj: 0\/50 activations, expires 2026-12-31/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cohort CLI: no command prints help (exit 0); unknown command exits 1', () => {
  const help = run([], tmpdir());
  assert.match(help, /manage feedback-project activation cohorts/);
  assert.throws(() => execFileSync('node', [CLI, 'bogus'], { encoding: 'utf8' }));
});
