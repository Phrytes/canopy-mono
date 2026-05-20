#!/usr/bin/env node
/**
 * Recombination demo — runnable.
 *
 *   node examples/manifest-host-demo/index.js
 *
 * Composes household + tasks-v0 (multi-crew) in one process via
 * `@canopy/manifest-host`, drives a chat-agent over the merged tool
 * catalog with a scripted LLM, prints the conversation + final state.
 *
 * Matching test at `test/recombination.test.js` asserts the same
 * scenario without the console noise.
 */

import {
  setupRecombinationDemo,
  runScriptedConversation,
  DEMO_USER_MESSAGES,
} from './scenario.js';

const log = (msg = '') => console.log(msg);

async function main() {
  log();
  log('@canopy manifest-host recombination demo');
  log('— composing household + tasks-v0 in one chat surface');
  log();

  const runtime = await setupRecombinationDemo();

  log('mounted apps:        ' + runtime.host.list().join(', '));
  log('composed toolCatalog: ' + runtime.composed.toolCatalog.length + ' tools');
  log('  household tools:   ' +
    runtime.composed.toolCatalog.filter((t) => t.id.startsWith('household.')).length);
  log('  tasks tools:       ' +
    runtime.composed.toolCatalog.filter((t) => t.id.startsWith('tasks.')).length);
  log('command collisions:  ' + runtime.composed.collisions.length);
  log();

  log('— conversation —');
  const turns = await runScriptedConversation(runtime, DEMO_USER_MESSAGES);
  for (const [i, turn] of turns.entries()) {
    log(`  user[${i + 1}]:  ${turn.userText}`);
    for (const reply of turn.replies) {
      log(`  bot:        ${reply.text ?? '(no text)'}`);
    }
  }
  log();

  log('— final state —');
  log('household open items (by type):');
  for (const type of ['shopping', 'errand', 'repair', 'schedule', 'task']) {
    const items = await runtime.householdStore.listOpen({ type });
    if (items.length === 0) continue;
    log(`  ${type}: [${items.map((i) => i.text).join(', ')}]`);
  }
  const tasksItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
  log('tasks.primary-crew open items:');
  for (const it of tasksItems) {
    log(`  ${it.text}`);
  }
  log();

  await runtime.teardown();
  log('✓ done');
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err);
  process.exit(1);
});
