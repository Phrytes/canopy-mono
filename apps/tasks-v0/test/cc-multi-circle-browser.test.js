/**
 * createBrowserMultiCircleTasksAgent — per-circle task isolation.
 *
 * The basis circle work treats `circleId ≡ circleId`, so a task
 * created while a circle is open must land in that circle's circle and
 * stay isolated from other circles.  This proves the browser multi-circle
 * factory routes + isolates storage, and that unscoped calls still fall
 * back to the primary circle (the legacy single-circle behaviour).
 */
import { describe, it, expect } from 'vitest';
import { DataPart, AgentIdentity, InternalBus } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createBrowserMultiCircleTasksAgent } from '../src/browser.js';

const ANNE = 'https://id.example/anne';

async function call(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`call: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from,
    agent,
    envelope: null,
  });
}

async function build() {
  return createBrowserMultiCircleTasksAgent({
    bus:           new InternalBus(),
    identityVault: new VaultMemory(),
    primaryCircleConfig: {
      circleId:  'cc-default',
      name:    'CC',
      kind:    'household',
      members: [{ webid: ANNE, displayName: 'Anne', role: 'admin' }],
    },
  });
}

describe('createBrowserMultiCircleTasksAgent', () => {
  it('boots with the primary circle in the map', async () => {
    const { circlesMap, primaryCircleState } = await build();
    expect(circlesMap.size).toBe(1);
    expect(circlesMap.get('cc-default')).toBe(primaryCircleState);
  });

  it('unscoped addTask routes to the primary circle (legacy behaviour)', async () => {
    const { agent } = await build();
    await call(agent, 'addTask', { text: 'primary task' });
    const primary = await call(agent, 'listOpen', { circleId: 'cc-default' });
    expect((primary.items ?? []).map((t) => t.text)).toContain('primary task');
  });

  it('a task created in circle A is isolated from circle B', async () => {
    const { agent, ensureCircle } = await build();
    await ensureCircle('circle-a');
    await ensureCircle('circle-b');

    await call(agent, 'addTask', { circleId: 'circle-a', text: 'A task' });
    await call(agent, 'addTask', { circleId: 'circle-b', text: 'B task' });

    const a = await call(agent, 'listOpen', { circleId: 'circle-a' });
    const b = await call(agent, 'listOpen', { circleId: 'circle-b' });
    const aTexts = (a.items ?? []).map((t) => t.text);
    const bTexts = (b.items ?? []).map((t) => t.text);

    expect(aTexts).toContain('A task');
    expect(aTexts).not.toContain('B task');
    expect(bTexts).toContain('B task');
    expect(bTexts).not.toContain('A task');
  });

  it('_scope is honoured as a circleId alias', async () => {
    const { agent, ensureCircle } = await build();
    await ensureCircle('circle-s');
    await call(agent, 'addTask', { _scope: 'circle-s', text: 'scoped task' });
    const s = await call(agent, 'listOpen', { _scope: 'circle-s' });
    expect((s.items ?? []).map((t) => t.text)).toContain('scoped task');
  });

  it('ensureCircle is idempotent', async () => {
    const { ensureCircle, circlesMap } = await build();
    const a1 = await ensureCircle('circle-x');
    const a2 = await ensureCircle('circle-x');
    expect(a1).toBe(a2);
    expect(circlesMap.has('circle-x')).toBe(true);
  });
});
