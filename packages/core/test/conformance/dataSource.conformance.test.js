/**
 * DataSource PORT conformance — run the harness against the reference adapter
 * `MemorySource` (@onderling/core). Implementing the port + passing this harness is
 * the definition of "compatible with the @onderling SDK". See docs/conventions/ports.md.
 */
import { describe, it } from 'vitest';
import { assertDataSourceConformance } from '@onderling/core/conformance';
import { MemorySource } from '../../src/storage/MemorySource.js';

describe('DataSource port — MemorySource (reference adapter)', () => {
  it('satisfies the DataSource port (incl. query)', async () => {
    await assertDataSourceConformance(() => new MemorySource(),
      { label: 'MemorySource', supportsQuery: true });
  });
});
