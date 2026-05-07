/**
 * navigation tests — route-table integrity.
 *
 * App.js itself contains JSX and isn't imported here (vitest's
 * default Vite transform doesn't process JSX in `.js` files); a
 * dedicated render test will land alongside the screen tests in
 * Phase 40.10.6.
 */

import { describe, it, expect } from 'vitest';
import { ROUTES, ROUTE_ORDER, SHELL_TAB_ROUTES, STACK_ONLY_ROUTES } from '../src/navigation.js';

describe('navigation route table', () => {
  it('every named route appears in the order array', () => {
    for (const name of Object.values(ROUTES)) {
      expect(ROUTE_ORDER).toContain(name);
    }
  });

  it('order array has no duplicates', () => {
    expect(new Set(ROUTE_ORDER).size).toBe(ROUTE_ORDER.length);
  });

  it('MetadataWarning is first (covers first launch)', () => {
    // Phase 40.22 (2026-05-08): the first-launch privacy notice
    // gates Welcome.  Subsequent launches navigate straight to
    // Welcome (App.js resolves the initial route via
    // hasSeenMetadataWarning).
    expect(ROUTE_ORDER[0]).toBe(ROUTES.MetadataWarning);
    expect(ROUTE_ORDER[1]).toBe(ROUTES.Welcome);
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

  it('SHELL_TAB_ROUTES + STACK_ONLY_ROUTES + Shell tile up to ROUTE_ORDER', () => {
    const expected = new Set([...SHELL_TAB_ROUTES, ...STACK_ONLY_ROUTES, ROUTES.Shell]);
    expect(new Set(ROUTE_ORDER)).toEqual(expected);
  });

  it('SHELL_TAB_ROUTES contains the user-facing main destinations', () => {
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.Feed);
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.Mine);
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.ChatThreads);
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.Contacts);
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.ProfileMine);
    expect(SHELL_TAB_ROUTES).toContain(ROUTES.Settings);
  });

  it('ROUTE_ORDER and ROUTES expose the same set of names', () => {
    expect(new Set(ROUTE_ORDER)).toEqual(new Set(Object.values(ROUTES)));
  });
});
