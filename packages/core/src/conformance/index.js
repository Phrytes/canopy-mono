/**
 * Port conformance harness — the executable form of the `@canopy/core`
 * compatibility contract (see docs/conventions/ports.md).
 *
 * A third party (or another `@canopy/*` package) writing an adapter proves it
 * satisfies a port by wiring the matching `assert…Conformance` helper into its
 * own test suite:
 *
 *   import { assertTransportConformance } from '@canopy/core/conformance';
 *
 * Peer requirement: these helpers assert via `vitest`'s `expect`, so they are
 * consumed from a `vitest` test (vitest is a peer of this subpath). They are
 * otherwise runner-agnostic — they only take factories and assert.
 */
export {
  assertTransportConformance,
  REQUIRED_TRANSPORT_METHODS,
} from './transportConformance.js';

export {
  assertDataSourceConformance,
  REQUIRED_DATASOURCE_METHODS,
} from './dataSourceConformance.js';

export {
  assertActorResolverConformance,
} from './actorResolverConformance.js';
