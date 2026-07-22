/**
 * StorageBackend PORT conformance — run the harness against the reference adapter
 * `MemoryStorageBackend` (@onderling/core). Implementing the port + passing this
 * harness is the definition of a store the seal can gate. See docs/conventions/ports.md.
 */
import { describe, it } from 'vitest';
import { assertStorageBackendConformance } from '@onderling/core/conformance';
import { MemoryStorageBackend } from '../../src/storage/MemoryStorageBackend.js';

describe('StorageBackend port — MemoryStorageBackend (reference adapter)', () => {
  it('satisfies the StorageBackend port', async () => {
    await assertStorageBackendConformance(() => new MemoryStorageBackend(),
      { label: 'MemoryStorageBackend' });
  });
});
