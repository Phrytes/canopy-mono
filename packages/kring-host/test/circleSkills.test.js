import { describe, it, expect } from 'vitest';
import {
  SKILL_AXES, DEFAULT_SKILL, normalizeSkill, mergeSkill,
  MATCH_SOURCES, buildSkillMatches,
} from '../src/circleSkills.js';

describe('circleSkills · normalizeSkill', () => {
  it('fills defaults for an empty/garbage input', () => {
    expect(normalizeSkill()).toEqual(DEFAULT_SKILL);
    expect(normalizeSkill(null)).toEqual(DEFAULT_SKILL);
    expect(normalizeSkill('nope')).toEqual(DEFAULT_SKILL);
  });

  it('keeps valid enum values and rejects invalid ones', () => {
    const s = normalizeSkill({ openness: 'public', posture: 'negotiable', status: 'paused', radius: 'city' });
    expect(s.openness).toBe('public');
    expect(s.posture).toBe('negotiable');
    expect(s.status).toBe('paused');
    expect(s.radius).toBe('city');

    const bad = normalizeSkill({ openness: 'bogus', posture: 'maybe', status: 'gone', radius: 'planet' });
    expect(bad.openness).toBe('private');
    expect(bad.posture).toBe('always');
    expect(bad.status).toBe('active');
    expect(bad.radius).toBe('home');
  });

  it('keeps a string name and defaults a non-string one', () => {
    expect(normalizeSkill({ name: 'lawn mowing' }).name).toBe('lawn mowing');
    expect(normalizeSkill({ name: 42 }).name).toBe('');
  });

  it('every axis default is the first listed enum value', () => {
    for (const axis of Object.keys(SKILL_AXES)) {
      expect(DEFAULT_SKILL[axis]).toBe(SKILL_AXES[axis][0]);
    }
  });
});

describe('circleSkills · mergeSkill', () => {
  it('applies a patch over a base without dropping other axes', () => {
    const base = normalizeSkill({ name: 'baking', openness: 'circle' });
    const next = mergeSkill(base, { status: 'paused' });
    expect(next.name).toBe('baking');     // preserved
    expect(next.openness).toBe('circle'); // preserved
    expect(next.status).toBe('paused');   // changed
  });

  it('normalises an invalid patch value back to default', () => {
    const next = mergeSkill(DEFAULT_SKILL, { radius: 'galaxy' });
    expect(next.radius).toBe('home');
  });
});

describe('circleSkills · buildSkillMatches', () => {
  it('returns [] for empty / missing input', () => {
    expect(buildSkillMatches()).toEqual([]);
    expect(buildSkillMatches({})).toEqual([]);
    expect(buildSkillMatches({ matches: [] })).toEqual([]);
    expect(buildSkillMatches({ matches: 'nope' })).toEqual([]);
  });

  it('tags each match source, defaulting unknown / missing to human', () => {
    const rows = buildSkillMatches({
      matches: [
        { id: 'a', label: 'Bert', source: 'human' },
        { id: 'b', label: 'Tuinbot', source: 'agent' },
        { id: 'c', label: 'Sjoerd', source: 'via-hop' },
        { id: 'd', label: 'Unknown', source: 'mystery' },
        { id: 'e', label: 'NoSource' },
      ],
    });
    expect(MATCH_SOURCES).toEqual(['human', 'agent', 'via-hop']);
    expect(rows.map((r) => r.source)).toEqual(['human', 'agent', 'via-hop', 'human', 'human']);
    expect(rows[0]).toEqual({ id: 'a', label: 'Bert', source: 'human' });
  });

  it('synthesises an id when missing and defaults a missing label', () => {
    const rows = buildSkillMatches({ matches: [{ source: 'agent' }, null, 5] });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('match-0');
    expect(rows[0].label).toBe('');
    expect(rows[0].source).toBe('agent');
  });
});
