/**
 * V2.2 — bot.invoice command.
 */

import { describe, it, expect } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE  = 'https://id.example/anne';
const CAROL = 'https://id.example/carol';

const CREW = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: CAROL, displayName: 'Carol', role: 'member', compensated: true, rate: 80 },
  ],
  compensation: { enabled: true, currency: 'EUR' },
};

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

describe('V2.2 — bot.invoice', () => {
  it('dispatcher routes "invoice" to bot.invoice', () => {
    expect(dispatch('invoice')).toEqual({ kind: 'skill', skillId: 'bot.invoice', args: {} });
    expect(dispatch('comp')).toEqual({ kind: 'skill', skillId: 'bot.invoice', args: {} });
  });

  it('bot.invoice for a paid-pro returns the table; non-pro gets the empty message', async () => {
    const bundle = buildBundle();
    const crew = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    // Generate a completion for Carol so the table is non-empty.
    const r = await call(crew, 'addTask', { text: 'Carol does it', estimateMinutes: 90 }, ANNE);
    await call(crew, 'claimTask',    { id: r.task.id }, CAROL);
    await call(crew, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));

    const def = crew.agent.skills.get('bot.invoice');
    const carolReply = await def.handler({ parts: [], from: CAROL, agent: crew.agent, envelope: null });
    expect(carolReply.text).toMatch(/Compensation/);
    expect(carolReply.text).toMatch(/1\.50 h/);
    expect(carolReply.text).toMatch(/120\.00 EUR/);

    const anneReply = await def.handler({ parts: [], from: ANNE, agent: crew.agent, envelope: null });
    expect(anneReply.text).toMatch(/no compensation recorded/i);

    await crew.close();
  });
});
