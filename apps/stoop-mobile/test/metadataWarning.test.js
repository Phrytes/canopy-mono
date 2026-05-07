/**
 * metadataWarning — coverage of the seen-state helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasSeenMetadataWarning, markMetadataWarningSeen, resetMetadataWarning,
  KEY_METADATA_SEEN,
} from '../src/lib/metadataWarning.js';

function makeStorage() {
  const store = new Map();
  return {
    getItem:    async (k) => store.get(k) ?? null,
    setItem:    async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
    _store:     store,
  };
}

describe('metadataWarning', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('returns false on first launch', async () => {
    expect(await hasSeenMetadataWarning({ storage })).toBe(false);
  });

  it('returns true after markMetadataWarningSeen', async () => {
    await markMetadataWarningSeen({ storage });
    expect(await hasSeenMetadataWarning({ storage })).toBe(true);
  });

  it('persists "1" in storage under KEY_METADATA_SEEN', async () => {
    await markMetadataWarningSeen({ storage });
    expect(storage._store.get(KEY_METADATA_SEEN)).toBe('1');
  });

  it('accepts legacy "true" / "yes" values too (back-compat)', async () => {
    await storage.setItem(KEY_METADATA_SEEN, 'true');
    expect(await hasSeenMetadataWarning({ storage })).toBe(true);
    await storage.setItem(KEY_METADATA_SEEN, 'yes');
    expect(await hasSeenMetadataWarning({ storage })).toBe(true);
  });

  it('reset clears the flag', async () => {
    await markMetadataWarningSeen({ storage });
    await resetMetadataWarning({ storage });
    expect(await hasSeenMetadataWarning({ storage })).toBe(false);
  });
});
