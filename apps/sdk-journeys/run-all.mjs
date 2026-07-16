/**
 * run-all — execute every SDK developer journey and summarize.
 *
 * Each journey is a self-contained script run in its own Node process, so
 * one journey's state (module caches, agents, timers) cannot leak into the
 * next. A journey passes when it exits 0 after printing its final
 * "✓ J<n> <name>: PASS" line; any non-zero exit marks the run failed.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const JOURNEYS = [
  'j1-wire-bot.mjs',
  'j2-slash-bot.mjs',
  'j3-tasks-app.mjs',
  'j4-pod-data.mjs',
  'j5-scaffold.mjs',
];

const results = [];
for (const file of JOURNEYS) {
  console.log(`\n━━━ ${file} ${'━'.repeat(Math.max(0, 60 - file.length))}`);
  const { status } = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  results.push({ file, ok: status === 0 });
}

console.log(`\n${'═'.repeat(66)}`);
console.log('SDK journeys summary:');
for (const { file, ok } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${file}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} journeys passed`);

process.exit(failed.length === 0 ? 0 : 1);
