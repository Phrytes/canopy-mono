/**
 * ActorResolver PORT conformance — run the harness against the reference adapter
 * `createInMemoryActorResolver()` (@canopy/core). Implementing the port + passing
 * this harness is the definition of "compatible with the @canopy SDK".
 * See docs/conventions/ports.md.
 */
import { describe, it } from 'vitest';
import { assertActorResolverConformance } from '@canopy/core/conformance';
import { createInMemoryActorResolver } from '../../src/permissions/ActorResolver.js';

describe('ActorResolver port — createInMemoryActorResolver (reference adapter)', () => {
  it('satisfies the ActorResolver port', async () => {
    await assertActorResolverConformance(() => createInMemoryActorResolver(),
      { label: 'InMemoryActorResolver' });
  });
});
