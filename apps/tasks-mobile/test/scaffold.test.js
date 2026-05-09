/**
 * scaffold smoke — Phase 41.1.
 *
 * Asserts the scaffold imports cleanly + App.js exports a function.
 * Subsequent phases add their own focused tests under test/screens,
 * test/lib, etc.; the scaffold smoke proves the workspace is wired
 * (vitest config aliases resolve, setup.js mocks compose, App.js's
 * NavigationContainer + SafeAreaProvider chain doesn't crash on
 * import).
 */

import { describe, it, expect } from 'vitest';
import App from '../App.js';

describe('Phase 41.1 scaffold', () => {
  it('App.js exports a function (the root component)', () => {
    expect(typeof App).toBe('function');
  });
});
