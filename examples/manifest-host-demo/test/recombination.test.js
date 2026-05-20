/**
 * SP-4b + SP-11 recombination demo — integration test.
 *
 * Drives the same scenario as `index.js` (the runnable demo) and
 * asserts:
 *   - the host composes both apps cleanly (namespacing, no
 *     collisions for this two-app combo);
 *   - LLM-driven tool calls dispatch through the composed
 *     `toolHandlers` and reach the right app's store;
 *   - multi-crew dispatch through the host preserves crew
 *     isolation (the `tasks.addTask({crewId:'primary-crew', text})`
 *     call lands in primary crew's itemStore, not anywhere else);
 *   - the chat-agent's reply pipeline produces an outbox entry per
 *     turn.
 *
 * The test deliberately uses the SAME `scenario.js` module as the
 * demo so a behavioural regression on either fails the test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  setupRecombinationDemo,
  runScriptedConversation,
  DEMO_USER_MESSAGES,
} from '../scenario.js';

describe('SP-4b + SP-11: recombination demo (household + tasks-v0)', () => {
  let runtime;

  beforeEach(async () => {
    runtime = await setupRecombinationDemo();
  });

  afterEach(async () => {
    await runtime?.teardown();
  });

  describe('host composition', () => {
    it('mounts both apps', () => {
      expect(runtime.host.list().sort()).toEqual(['household', 'tasks']);
    });

    it('composed toolCatalog covers tools from both apps with appId.opId namespacing', () => {
      const ids = runtime.composed.toolCatalog.map((t) => t.id);
      // household tools (sample — at least these must be present).
      expect(ids).toContain('household.addItem');
      expect(ids).toContain('household.listOpen');
      // tasks tools (sample).
      expect(ids).toContain('tasks.addTask');
      expect(ids).toContain('tasks.listOpen');
    });

    it('reports zero command collisions for this two-app combo', () => {
      // household has slash; tasks-v0 (SP-3 V0) explicitly does not.
      // Confirms the V0 host's collision-detection is functioning
      // even when zero collisions exist.
      expect(runtime.composed.collisions).toEqual([]);
    });

    it('exposes perAppSystemPrompts keyed per app, not concatenated', () => {
      expect(Object.keys(runtime.composed.perAppSystemPrompts).sort())
        .toEqual(['household', 'tasks']);
    });
  });

  describe('scripted conversation — recombination end-to-end', () => {
    it('every user turn produces at least one outbox reply', async () => {
      const turns = await runScriptedConversation(runtime, DEMO_USER_MESSAGES);
      expect(turns).toHaveLength(DEMO_USER_MESSAGES.length);
      for (const t of turns) {
        expect(t.replies.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('turn 1 (household.addItem) writes to the household store', async () => {
      await runScriptedConversation(runtime, [DEMO_USER_MESSAGES[0]]);
      const shopping = await runtime.householdStore.listOpen({ type: 'shopping' });
      expect(shopping.map((i) => i.text)).toContain('bread');
    });

    it('turn 2 (tasks.addTask) writes to primary crew\'s itemStore (multi-crew dispatch through host)', async () => {
      // Run turns 1 then 2 — scripted LLM advances its cursor each call.
      await runScriptedConversation(runtime, [
        DEMO_USER_MESSAGES[0],
        DEMO_USER_MESSAGES[1],
      ]);

      const primaryItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
      const titles       = primaryItems.map((it) => it.text);
      expect(titles).toContain('paint the hallway');
    });

    it('cross-app isolation — household tasks list is empty even after tasks.addTask', async () => {
      // tasks.addTask writes to tasks-v0's itemStore, NOT household's
      // tasks list — even though household ALSO has an addTask op
      // (SP-2).  Namespacing in the composed catalog prevents the
      // confusion at dispatch time.
      await runScriptedConversation(runtime, [
        DEMO_USER_MESSAGES[0],
        DEMO_USER_MESSAGES[1],
      ]);

      // Household's tasks-list is unaffected by tasks.addTask.
      const householdTasks = await runtime.householdStore.listOpen({ type: 'task' });
      expect(householdTasks.map((i) => i.text)).not.toContain('paint the hallway');
    });

    it('full scripted run keeps household + tasks state cleanly separated', async () => {
      await runScriptedConversation(runtime, DEMO_USER_MESSAGES);

      // Household side — bread is in shopping.
      const householdShopping = await runtime.householdStore.listOpen({ type: 'shopping' });
      expect(householdShopping.map((i) => i.text)).toContain('bread');

      // Tasks side — paint the hallway is in primary crew's itemStore.
      const tasksItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
      expect(tasksItems.map((i) => i.text)).toContain('paint the hallway');

      // No cross-contamination — household shopping doesn't carry the
      // tasks item, even though both ran through the same chat session.
      expect(householdShopping.map((i) => i.text)).not.toContain('paint the hallway');
    });
  });
});
