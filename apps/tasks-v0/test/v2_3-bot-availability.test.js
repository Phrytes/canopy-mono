/**
 * bot.available + bot.week.
 */

import { describe, it, expect } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE = 'https://id.example/anne';
const KID  = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: KID,  displayName: 'Kid',  role: 'member' },
  ],
  availabilityHints: { enabled: true, optedIn: [KID] },
};

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

describe('V2.3 — bot.available / bot.week', () => {
  it('dispatcher routes "available <state>"', () => {
    expect(dispatch('available open')).toEqual({ kind: 'skill', skillId: 'bot.available', args: { state: 'open' } });
    expect(dispatch('avail tight')).toEqual({ kind: 'skill', skillId: 'bot.available', args: { state: 'tight' } });
    expect(dispatch('week')).toEqual({ kind: 'skill', skillId: 'bot.week', args: {} });
  });

  it('"available" without a state replies with valid-state list', () => {
    const r = dispatch('available');
    expect(r.kind).toBe('reply');
    expect(r.text).toMatch(/open.*tight.*unavailable/);
  });

  it('bot.available sets the current half-day for the actor', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    const def = circle.agent.skills.get('bot.available');
    const reply = await def.handler({
      parts: [{ type: 'DataPart', data: { state: 'open' } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    expect(reply.text).toMatch(/open/);
    // Persisted blob should exist.
    const path = `mem://tasks/circles/oss-tools/availability/${encodeURIComponent(KID)}.json`;
    expect(await bundle.cache.read(path)).toBeTruthy();
    await circle.close();
  });

  it('bot.available with bogus state replies with valid-state list', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    const def = circle.agent.skills.get('bot.available');
    const reply = await def.handler({
      parts: [{ type: 'DataPart', data: { state: 'bogus' } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    expect(reply.text).toMatch(/Valid states/i);
    await circle.close();
  });

  it('bot.week renders the grid for an opted-in member', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
    // KID is opted in via CIRCLE.optedIn, so bot.week renders the current-week grid
    // (empty cells show as 'unknown'). No hint seed needed — the asserts below check
    // the rendered week header + day labels, not any stored value.
    const def = circle.agent.skills.get('bot.week');
    const reply = await def.handler({ parts: [], from: KID, agent: circle.agent, envelope: null });
    expect(reply.text).toMatch(/Week/);
    expect(reply.text).toContain('mon');
    await circle.close();
  });
});
