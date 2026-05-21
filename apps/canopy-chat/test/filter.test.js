/**
 * canopy-chat — filter DSL tests.  v0.2 sub-slice 2.2.
 */
import { describe, it, expect } from 'vitest';

import {
  matchesFilter, normaliseFilter, isWildcardFilter, describeFilter,
} from '../src/filter.js';

const ev = (overrides = {}) => ({
  id:    'e-1',
  ts:    1_700_000_000_000,
  app:   'household',
  type:  'notification',
  actor: 'webid:anne',
  ...overrides,
});

describe('matchesFilter — wildcard behaviour', () => {
  it('matches when filter is null / undefined / empty object', () => {
    expect(matchesFilter(ev(), null)).toBe(true);
    expect(matchesFilter(ev(), undefined)).toBe(true);
    expect(matchesFilter(ev(), {})).toBe(true);
  });

  it('empty arrays act as wildcards', () => {
    expect(matchesFilter(ev(), { apps: [], eventTypes: [] })).toBe(true);
  });

  it("'*' inside any array is a wildcard for that key", () => {
    expect(matchesFilter(ev(), { apps: ['*'] })).toBe(true);
    expect(matchesFilter(ev(), { apps: ['*', 'household'] })).toBe(true);
  });
});

describe('matchesFilter — single-key matches', () => {
  it('apps: includes the event app', () => {
    expect(matchesFilter(ev(), { apps: ['household'] })).toBe(true);
    expect(matchesFilter(ev({ app: 'tasks-v0' }), { apps: ['household'] })).toBe(false);
  });

  it('apps: OR within the array', () => {
    expect(matchesFilter(ev({ app: 'tasks-v0' }), { apps: ['household', 'tasks-v0'] }))
      .toBe(true);
    expect(matchesFilter(ev({ app: 'stoop' }), { apps: ['household', 'tasks-v0'] }))
      .toBe(false);
  });

  it('eventTypes: filter by type', () => {
    expect(matchesFilter(ev({ type: 'reminder' }), { eventTypes: ['notification', 'reminder'] }))
      .toBe(true);
    expect(matchesFilter(ev({ type: 'sync' }), { eventTypes: ['notification'] }))
      .toBe(false);
  });

  it('actors: filter by webid', () => {
    expect(matchesFilter(ev(), { actors: ['webid:anne', 'webid:karl'] })).toBe(true);
    expect(matchesFilter(ev({ actor: 'webid:bob' }), { actors: ['webid:anne'] }))
      .toBe(false);
  });
});

describe('matchesFilter — multi-key (AND across keys)', () => {
  it('all specified keys must match', () => {
    expect(matchesFilter(ev(), {
      apps: ['household'], eventTypes: ['notification'],
    })).toBe(true);
    expect(matchesFilter(ev(), {
      apps: ['household'], eventTypes: ['reminder'],
    })).toBe(false);
    expect(matchesFilter(ev(), {
      apps: ['tasks-v0'], eventTypes: ['notification'],
    })).toBe(false);
  });

  it('mix of specified + wildcard keys', () => {
    expect(matchesFilter(ev(), { apps: ['household'], actors: [] })).toBe(true);
    expect(matchesFilter(ev(), { apps: ['*'], actors: ['webid:anne'] })).toBe(true);
    expect(matchesFilter(ev(), { apps: ['*'], actors: ['webid:bob'] })).toBe(false);
  });
});

describe('matchesFilter — edge cases', () => {
  it('returns false for invalid events', () => {
    expect(matchesFilter(null, { apps: ['*'] })).toBe(false);
    expect(matchesFilter(undefined, {})).toBe(false);
    expect(matchesFilter('not-an-event', {})).toBe(false);
  });

  it('event with missing actor — only matches when actors filter is wildcard', () => {
    const noActor = ev({ actor: undefined });
    expect(matchesFilter(noActor, {})).toBe(true);
    expect(matchesFilter(noActor, { actors: ['*'] })).toBe(true);
    expect(matchesFilter(noActor, { actors: ['webid:anne'] })).toBe(false);
  });

  it('event with empty-string app does not match a non-wildcard apps filter', () => {
    expect(matchesFilter(ev({ app: '' }), { apps: ['household'] })).toBe(false);
    expect(matchesFilter(ev({ app: '' }), { apps: ['*'] })).toBe(true);
    expect(matchesFilter(ev({ app: '' }), {})).toBe(true);
  });
});

describe('normaliseFilter', () => {
  it('drops empty arrays + de-dupes + sorts', () => {
    expect(normaliseFilter({
      apps:       ['tasks-v0', 'household', 'household'],
      eventTypes: [],
      actors:     ['webid:karl', 'webid:anne'],
    })).toEqual({
      apps:   ['household', 'tasks-v0'],
      actors: ['webid:anne', 'webid:karl'],
    });
  });

  it("returns {} for null/undefined/empty inputs", () => {
    expect(normaliseFilter(null)).toEqual({});
    expect(normaliseFilter(undefined)).toEqual({});
    expect(normaliseFilter({})).toEqual({});
  });

  it('coerces non-string values to strings', () => {
    expect(normaliseFilter({ apps: [1, 2, 1] })).toEqual({ apps: ['1', '2'] });
  });

  it('is idempotent', () => {
    const once  = normaliseFilter({ apps: ['b', 'a', 'a'] });
    const twice = normaliseFilter(once);
    expect(twice).toEqual(once);
  });
});

describe('isWildcardFilter', () => {
  it('true for null / undefined / empty', () => {
    expect(isWildcardFilter(null)).toBe(true);
    expect(isWildcardFilter(undefined)).toBe(true);
    expect(isWildcardFilter({})).toBe(true);
  });

  it("true when every key is empty or contains '*'", () => {
    expect(isWildcardFilter({ apps: [], eventTypes: ['*'] })).toBe(true);
    expect(isWildcardFilter({ apps: ['*'], eventTypes: ['*'], actors: ['*'] })).toBe(true);
  });

  it('false when any key has a non-wildcard list', () => {
    expect(isWildcardFilter({ apps: ['household'] })).toBe(false);
    expect(isWildcardFilter({ apps: ['*'], actors: ['webid:anne'] })).toBe(false);
  });
});

describe('describeFilter', () => {
  it("returns '*' for wildcard filters", () => {
    expect(describeFilter(null)).toBe('*');
    expect(describeFilter({})).toBe('*');
    expect(describeFilter({ apps: ['*'] })).toBe('*');
  });

  it('joins specified keys with comma', () => {
    expect(describeFilter({ apps: ['household'] })).toBe('app:household');
    expect(describeFilter({
      apps: ['household'], eventTypes: ['notification', 'reminder'],
    })).toBe('app:household, type:notification|reminder');
    expect(describeFilter({
      apps: ['household'], eventTypes: ['notification'], actors: ['webid:anne'],
    })).toBe('app:household, type:notification, actor:webid:anne');
  });
});
