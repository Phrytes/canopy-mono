/**
 * scaffold smoke — Phase 41.1 + 41.3.
 *
 * Asserts the route table is wired + the alias map resolves end-to-end.
 * (Importing App.js directly trips a TS-parser trap deep in the RN
 * dependency graph; we test the underlying modules instead — same
 * pattern stoop-mobile uses.)
 */

import { describe, it, expect } from 'vitest';
import { ROUTES } from '../src/navigation.js';
import { TASKS_CLASSIFIERS } from '../src/lib/qrClassifiers.js';

describe('Phase 41.1 + 41.3 scaffold', () => {
  it('navigation.ROUTES exposes all onboarding routes', () => {
    expect(typeof ROUTES.Welcome).toBe('string');
    expect(typeof ROUTES.OnboardScan).toBe('string');
    expect(typeof ROUTES.OnboardRestore).toBe('string');
    expect(typeof ROUTES.OnboardIssue).toBe('string');
    expect(typeof ROUTES.Workspace).toBe('string');
  });

  it('TASKS_CLASSIFIERS exposes the four expected payload kinds', () => {
    const kinds = TASKS_CLASSIFIERS.map((c) => c.kind);
    expect(kinds).toEqual(['invite', 'bot-token', 'contact', 'recovery']);
    for (const c of TASKS_CLASSIFIERS) {
      expect(typeof c.classify).toBe('function');
    }
  });
});
