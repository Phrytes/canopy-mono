import { describe, it, expect } from 'vitest';
import * as podClient from '../src/index.js';

// Guard against the barrel-load regression from #15: when a symbol moves OUT of a dependency
// (SolidPodSource: core → pod-client), a dangling `import { X } from '@canopy/core'` inside the
// package breaks the ENTIRE barrel at ESM link time ("does not provide an export named X") — which
// the package's own unit tests don't catch (they import specific files, not the barrel). This test
// imports the barrel as a consumer would and asserts the public surface is present.
describe('@canopy/pod-client barrel loads (regression guard)', () => {
  it('exports its public surface', () => {
    for (const s of ['PodClient', 'SolidPodSource', 'PodExporter', 'IdentityPodStore', 'IdentitySync', 'migrateVaultToPod']) {
      expect(podClient[s], `@canopy/pod-client must export ${s}`).toBeDefined();
    }
  });
});
