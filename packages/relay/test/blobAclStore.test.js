/**
 * BlobAclStore tests — covers MemoryBlobAclStore + SqliteBlobAclStore
 * (the blob-gate membership-grant record, PLAN-media-infra-deployment).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryBlobAclStore } from '../src/blobAclStore.js';
import { SqliteBlobAclStore } from '../src/blobAclStore.js';

// Both backings must satisfy the same contract — run one spec against each.
const backings = [
  ['MemoryBlobAclStore', () => new MemoryBlobAclStore()],
  ['SqliteBlobAclStore (:memory:)', () => new SqliteBlobAclStore({ path: ':memory:' })],
];

for (const [name, make] of backings) {
  describe(name, () => {
    it('deny-by-default: check() is false for anything not granted', async () => {
      const store = make();
      expect(await store.check('alice', 'blob://k1')).toBe(false);
      await store.close();
    });

    it('grant() records a single actor; others stay denied', async () => {
      const store = make();
      await store.grant('blob://k1', 'alice');

      expect(await store.check('alice', 'blob://k1')).toBe(true);
      expect(await store.check('bob',   'blob://k1')).toBe(false);   // other actor
      expect(await store.check('alice', 'blob://k2')).toBe(false);   // other key
      await store.close();
    });

    it('grant() is idempotent', async () => {
      const store = make();
      await store.grant('blob://k1', 'alice');
      await store.grant('blob://k1', 'alice');
      expect(await store.check('alice', 'blob://k1')).toBe(true);
      await store.close();
    });

    it('grantMany() records a batch (grant-on-upload fan-out)', async () => {
      const store = make();
      await store.grantMany('blob://k1', ['alice', 'bob']);

      expect(await store.check('alice', 'blob://k1')).toBe(true);
      expect(await store.check('bob',   'blob://k1')).toBe(true);
      expect(await store.check('carol', 'blob://k1')).toBe(false);
      await store.close();
    });

    it('revokeKey() drops every grant for that key, leaves other keys intact', async () => {
      const store = make();
      await store.grantMany('blob://k1', ['alice', 'bob']);
      await store.grant('blob://k2', 'alice');

      await store.revokeKey('blob://k1');

      expect(await store.check('alice', 'blob://k1')).toBe(false);
      expect(await store.check('bob',   'blob://k1')).toBe(false);
      expect(await store.check('alice', 'blob://k2')).toBe(true);
      await store.close();
    });
  });
}

// ── SqliteBlobAclStore — durability across restarts ──────────────────────────

describe('SqliteBlobAclStore — persistence', () => {
  it('grants survive a close + reopen of the same file', async () => {
    const dir  = mkdtempSync(join(tmpdir(), 'blob-acl-sqlite-'));
    const file = join(dir, 'blob-acl.sqlite');
    try {
      const store1 = new SqliteBlobAclStore({ path: file });
      await store1.grantMany('blob://k1', ['alice', 'bob']);
      await store1.grant('blob://k2', 'carol');
      await store1.close();

      const store2 = new SqliteBlobAclStore({ path: file });
      expect(await store2.check('alice', 'blob://k1')).toBe(true);
      expect(await store2.check('bob',   'blob://k1')).toBe(true);
      expect(await store2.check('carol', 'blob://k2')).toBe(true);
      expect(await store2.check('carol', 'blob://k1')).toBe(false);  // deny-by-default survives too
      await store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
