/**
 * resolvePointers — unit tests.
 *
 * Covers:
 *   - resolves every pointer present in the input
 *   - drops absent / null pointer keys
 *   - per-pointer read failure is caught + surfaced via onError; other pointers still resolve
 *   - invalid arguments
 */

import { describe, it, expect } from 'vitest';
import { resolvePointers } from '../src/resolvePointers.js';

describe('resolvePointers', () => {
  it('resolves each pointer via the supplied read function', async () => {
    const pointers = {
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    };
    const store = new Map([
      ['https://alice.pod/private/storage-mapping', { mapping: 'value' }],
      ['https://alice.pod/private/agent-registry',  { agents: [] }],
    ]);
    const read = async (uri) => store.get(uri);

    const resolved = await resolvePointers(pointers, { read });
    expect(resolved).toEqual({
      storageMapping: { mapping: 'value' },
      agentRegistry:  { agents: [] },
    });
  });

  it('drops keys for pointers that are absent', async () => {
    const pointers = {
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      // no agentRegistryUri, no auditLogUri
    };
    const read = async () => 'whatever';
    const resolved = await resolvePointers(pointers, { read });
    expect(resolved).toEqual({ storageMapping: 'whatever' });
  });

  it('drops keys where read returns null/undefined', async () => {
    const pointers = {
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    };
    const read = async (uri) => uri.endsWith('storage-mapping') ? 'value' : null;
    const resolved = await resolvePointers(pointers, { read });
    expect(resolved).toEqual({ storageMapping: 'value' });
  });

  it('catches per-pointer read errors + surfaces them via onError', async () => {
    const pointers = {
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    };
    const errors = [];
    const read = async (uri) => {
      if (uri.endsWith('agent-registry')) throw new Error('boom');
      return { ok: true };
    };
    const onError = (err, key, uri) => errors.push({ msg: err.message, key, uri });

    const resolved = await resolvePointers(pointers, { read, onError });
    expect(resolved).toEqual({ storageMapping: { ok: true } });
    expect(errors).toEqual([{
      msg: 'boom',
      key: 'agentRegistry',
      uri: 'https://alice.pod/private/agent-registry',
    }]);
  });

  it('throws INVALID_ARGUMENT when pointers is not an object', async () => {
    await expect(resolvePointers(null, { read: async () => 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws INVALID_ARGUMENT when read is not a function', async () => {
    await expect(resolvePointers({ storageMappingUri: 'x' }, { read: null }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
