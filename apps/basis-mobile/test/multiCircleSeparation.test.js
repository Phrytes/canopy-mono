/**
 * Phase 5.3c — multi-circle tasks separation, mobile parity.
 *
 * Web shipped this in 5.3b: `apps/basis/src/core/agent/realAgent.js`
 * swapped `createBrowserTasksAgent` → `createBrowserMultiCircleTasksAgent`
 * and calls `tasksCircle.ensureCircle(args.circleId)` before every scoped
 * tasks dispatch.  Coverage on the web side lives in
 * `apps/basis/test/journeys-cross-app.test.js` under
 * **CC-TK.F1 — active-circle → app-scope binding (5.3)**.
 *
 * Mobile composes its bundle by dynamically importing the same portable
 * factory (`agentBundle.js → loadCreateRealHouseholdAgent`), so multi-
 * circle is inherited transparently — but until now there was no mobile-
 * scoped test asserting the separation through `bundle.callSkill`.  This
 * file closes that gap: a task created under `circleId:'circle-a'` must
 * NOT appear when reading `circleId:'circle-b'`, exercised end-to-end via
 * the mobile portable-core boot.
 */
import { describe, it, expect } from 'vitest';

import { bootAgentBundle } from '../src/core/agentBundle.js';

const BOOT_TIMEOUT = 15000;

async function bootMobileBundle() {
  const { VaultMemory } = await import('@onderling/vault');
  return bootAgentBundle({
    chatVault: new VaultMemory(),
    hostVault: new VaultMemory(),
    // No seedTasks override needed — primary circle gets the standard 4
    // seeds; the per-circle circles are spawned empty on demand.
  });
}

describe('5.3c basis-mobile — multi-circle tasks separation', () => {
  it('a task added in circle A is visible in A and absent from B', { timeout: BOOT_TIMEOUT }, async () => {
    const bundle = await bootMobileBundle();
    try {
      // Add in circle-a — the bundle's dispatch fires
      // `tasksCircle.ensureCircle('circle-a')` before invoke, spawning a
      // fresh per-circle CircleState whose store is keyed by circleId.
      const addA = await bundle.callSkill('tasks', 'addTask', {
        text: 'alpha task', circleId: 'circle-a',
      });
      expect(addA?.ok).toBe(true);

      const addB = await bundle.callSkill('tasks', 'addTask', {
        text: 'beta task', circleId: 'circle-b',
      });
      expect(addB?.ok).toBe(true);

      // Read each circle scoped — listOpen is what loadCircleItems
      // resolves to on its `getMyTasks` → tasks-v0 fallback path
      // (see realAgent.js TASKS_OP_ALIAS).
      const listA = await bundle.callSkill('tasks', 'listOpen', {
        circleId: 'circle-a',
      });
      const listB = await bundle.callSkill('tasks', 'listOpen', {
        circleId: 'circle-b',
      });

      const labelsA = (listA?.items ?? []).map((t) => t.text ?? t.title ?? t.label);
      const labelsB = (listB?.items ?? []).map((t) => t.text ?? t.title ?? t.label);

      expect(labelsA).toContain('alpha task');
      expect(labelsA).not.toContain('beta task');
      expect(labelsB).toContain('beta task');
      expect(labelsB).not.toContain('alpha task');
    } finally {
      await bundle.dispose();
    }
  });

  it('unscoped tasks stay in the primary circle, not leaked into circles', { timeout: BOOT_TIMEOUT }, async () => {
    const bundle = await bootMobileBundle();
    try {
      // Primary circle is pre-seeded with 4 tasks at boot (see realAgent.js
      // SEED_TASKS). Reading a brand-new circle must NOT surface them.
      const fresh = await bundle.callSkill('tasks', 'listOpen', {
        circleId: 'fresh-circle',
      });
      const labels = (fresh?.items ?? []).map((t) => t.text ?? t.title ?? t.label);
      expect(labels).not.toContain('Fix the leaky tap');   // seeded primary task
      expect(labels).not.toContain('Order groceries');     // seeded primary task
    } finally {
      await bundle.dispose();
    }
  });
});
