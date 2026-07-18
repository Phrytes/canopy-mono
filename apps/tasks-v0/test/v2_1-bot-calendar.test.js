/**
 * bot.calendar command.
 */

import { describe, it, expect } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE = 'https://id.example/anne';

const CIRCLE_ON = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [{ webid: ANNE, displayName: 'Anne', role: 'admin' }],
  calendarEmission: { enabled: true },
};
const CIRCLE_OFF = { ...CIRCLE_ON, calendarEmission: { enabled: false } };

describe('V2.1 — bot.calendar', () => {
  it('dispatcher routes "calendar" to bot.calendar', () => {
    expect(dispatch('calendar')).toEqual({ kind: 'skill', skillId: 'bot.calendar', args: {} });
    expect(dispatch('cal')).toEqual({ kind: 'skill', skillId: 'bot.calendar', args: {} });
    expect(dispatch('sync')).toEqual({ kind: 'skill', skillId: 'bot.calendar', args: {} });
  });

  it('bot.calendar returns the URL when emission is on', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig:           CIRCLE_ON,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    const def = circle.agent.skills.get('bot.calendar');
    const r = await def.handler({ parts: [], from: ANNE, agent: circle.agent, envelope: null });
    expect(r.text).toContain('mem://user/tasks/calendars/');
    expect(r.text).toContain(encodeURIComponent(ANNE));
    await circle.close();
  });

  it('bot.calendar returns the off-state hint when emission is off', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig:           CIRCLE_OFF,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    const def = circle.agent.skills.get('bot.calendar');
    const r = await def.handler({ parts: [], from: ANNE, agent: circle.agent, envelope: null });
    expect(r.text).toMatch(/calendar sync is off/i);
    await circle.close();
  });
});
