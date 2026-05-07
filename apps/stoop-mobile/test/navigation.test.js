/**
 * navigation tests — route-table integrity.
 *
 * App.js itself contains JSX and isn't imported here (vitest's
 * default Vite transform doesn't process JSX in `.js` files); a
 * dedicated render test will land alongside the screen tests in
 * Phase 40.10.6.
 */

import { describe, it, expect } from 'vitest';
import { ROUTES, ROUTE_ORDER } from '../src/navigation.js';

describe('navigation route table', () => {
  it('every named route appears in the order array', () => {
    for (const name of Object.values(ROUTES)) {
      expect(ROUTE_ORDER).toContain(name);
    }
  });

  it('order array has no duplicates', () => {
    expect(new Set(ROUTE_ORDER).size).toBe(ROUTE_ORDER.length);
  });

  it('Welcome is first (initial route)', () => {
    expect(ROUTE_ORDER[0]).toBe(ROUTES.Welcome);
  });

  it('all expected web-mirror routes are present', () => {
    // Sanity-check against §6 of the functional design.
    const expected = [
      'Welcome', 'OnboardScan', 'OnboardRestore', 'OnboardIssue',
      'SignIn', 'Feed', 'PostCompose', 'ItemDetail', 'Mine',
      'ChatThreads', 'ChatThread', 'ProfileMine', 'ProfileOther',
      'Contacts', 'Contact', 'Group', 'Settings', 'Privacy', 'Push',
      'Metrics',
    ];
    for (const name of expected) {
      expect(ROUTE_ORDER).toContain(name);
    }
  });

  it('ROUTE_ORDER and ROUTES expose the same set of names', () => {
    expect(new Set(ROUTE_ORDER)).toEqual(new Set(Object.values(ROUTES)));
  });
});
