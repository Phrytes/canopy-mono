/**
 * H6 V0 integration test — substrates wired together end-to-end.
 *
 * Migrated 2026-05-04 (Phase 5.1): the agent now writes directly via a
 * `core.DataSource` target (`MemorySource` in tests) instead of the
 * deleted V0 `SyncEngine + IngestQueueSource + InMemoryBackend`.
 *
 * Exercises:
 *   - `core.OAuthVault` — credentials supplied per source
 *   - `core.MemorySource` — write target
 *   - `@canopy/identity-resolver/PersonGraph` — auto-link on identifier collision
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySource } from '@canopy/core';
import { OAuthVault, VaultMemory } from '@canopy/vault';
import { PersonGraph } from '@canopy/identity-resolver/person-graph';

import {
  createImportAgent,
  MockConnector,
  GoogleDocsConnector,
} from '../src/index.js';

const POD_ROOT = 'https://test.example/pod';

describe('H6 V0 — MockConnector → MemorySource roundtrip', () => {
  let target;
  let agent;
  beforeEach(async () => {
    target = new MemorySource();
    const connector = new MockConnector({
      id: 'mock',
      items: [
        {
          relPath: 'imports/mock/doc-1.md',
          content: '# Hello\nThis is doc 1.',
          contentType: 'text/markdown',
          metadata: { sourceId: 'doc-1' },
          lastModified: 1700000000000,
        },
        {
          relPath: 'imports/mock/doc-2.md',
          content: '# Doc 2',
          contentType: 'text/markdown',
          metadata: { sourceId: 'doc-2' },
        },
      ],
    });
    agent = await createImportAgent({
      connectors: [connector],
      target,
      podRoot: POD_ROOT,
    });
    await agent.start();
  });

  it('runOnce streams items into the target', async () => {
    const result = await agent.runOnce();
    expect(result.imported).toBe(2);
    expect(result.errors).toEqual([]);

    const doc1 = await target.read(`${POD_ROOT}/imports/mock/doc-1.md`);
    expect(doc1.content).toContain('Hello');
    expect(doc1.contentType).toBe('text/markdown');

    const doc2 = await target.read(`${POD_ROOT}/imports/mock/doc-2.md`);
    expect(doc2.content).toContain('Doc 2');
  });

  it('emits one synced event per item', async () => {
    const synced = [];
    agent.events.on('synced', (e) => synced.push(e.path));
    await agent.runOnce();
    expect(synced).toHaveLength(2);
  });
});

describe('H6 V0 — PersonGraph integration', () => {
  it('observes identifier hints from items; auto-links across sources', async () => {
    const target = new MemorySource();
    const personGraph = new PersonGraph();

    const gmail = new MockConnector({
      id: 'gmail-mock',
      items: [
        {
          relPath: 'imports/gmail/msg-1.md',
          content: '# msg 1',
          contentType: 'text/markdown',
          people: [
            { kind: 'email', value: 'alice@example.com' },
            { kind: 'name-display', value: 'Alice Anderson' },
          ],
        },
      ],
    });
    const docs = new MockConnector({
      id: 'docs-mock',
      items: [
        {
          relPath: 'imports/docs/doc-1.md',
          content: '# doc 1',
          contentType: 'text/markdown',
          people: [
            { kind: 'email', value: 'alice@example.com' },     // same alice
            { kind: 'name-display', value: 'Alice A.' },        // different display
          ],
        },
      ],
    });

    const agent = await createImportAgent({
      connectors: [gmail, docs],
      target,
      podRoot: POD_ROOT,
      personGraph,
    });
    await agent.start();
    const result = await agent.runOnce();
    expect(result.imported).toBe(2);

    // Both messages reference alice@example.com → graph has one
    // Person with multiple identifiers + multiple observations.
    const alice = await personGraph.findByIdentifier({ kind: 'email', value: 'alice@example.com' });
    expect(alice).not.toBeNull();
    expect(alice.observations.length).toBeGreaterThanOrEqual(2);
  });
});

describe('H6 V0 — OAuthVault integration', () => {
  it('connector reads credentials from OAuthVault', async () => {
    const target = new MemorySource();
    const oauthVault = new OAuthVault({ vault: new VaultMemory() });
    await oauthVault.storeTokens('custom', null, {
      access:    'demo-token',
      expiresAt: Date.now() + 3600_000,
    });

    let receivedToken = null;
    const oauthAware = {
      id: 'oauth-aware',
      async *import({ oauthVault: vault }) {
        const c = await vault.getTokens('custom');
        receivedToken = c?.access;
        yield {
          relPath:     'imports/oauth-aware/x.md',
          content:     'x',
          contentType: 'text/markdown',
        };
      },
    };

    const agent = await createImportAgent({
      connectors: [oauthAware],
      target,
      podRoot:    POD_ROOT,
      oauthVault,
    });
    await agent.start();
    await agent.runOnce();

    expect(receivedToken).toBe('demo-token');
    expect(await target.read(`${POD_ROOT}/imports/oauth-aware/x.md`)).toBeTruthy();
  });

  it('oauth-vault refresh flows through to the connector', async () => {
    const target = new MemorySource();
    const oauthVault = new OAuthVault({ vault: new VaultMemory() });

    // Token expires within the 60-second refresh window relative to wall clock.
    await oauthVault.storeTokens('custom', null, {
      access:    'old-token',
      refresh:   'rt',
      expiresAt: Date.now() + 30_000,
    });

    const refresher = vi.fn(async (_refreshToken) => ({
      access:    'new-token',
      refresh:   'rt',
      expiresAt: Date.now() + 3600_000,
    }));
    oauthVault.registerRefreshFn('custom', refresher);

    let receivedToken = null;
    const c = {
      id: 'c',
      async *import({ oauthVault: v }) {
        const c = await v.getTokens('custom');
        receivedToken = c?.access;
        yield { relPath: 'imports/c/x.md', content: 'x', contentType: 'text/markdown' };
      },
    };

    const agent = await createImportAgent({
      connectors: [c],
      target,
      podRoot:    POD_ROOT,
      oauthVault,
    });
    await agent.start();
    await agent.runOnce();

    expect(refresher).toHaveBeenCalledOnce();
    expect(receivedToken).toBe('new-token');
  });
});

describe('H6 V0 — connector errors are isolated', () => {
  it('one failing connector does not abort the whole import', async () => {
    const target = new MemorySource();
    const failer = {
      id: 'failer',
      async *import() {
        throw new Error('connector crashed');
      },
    };
    const succeeder = new MockConnector({
      id: 'succeeder',
      items: [{ relPath: 'imports/succeeder/ok.md', content: 'ok', contentType: 'text/markdown' }],
    });

    const agent = await createImportAgent({
      connectors: [failer, succeeder],
      target,
      podRoot:    POD_ROOT,
    });
    await agent.start();
    const result = await agent.runOnce();

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].connector).toBe('failer');
    expect(await target.read(`${POD_ROOT}/imports/succeeder/ok.md`)).toBeTruthy();
  });
});

describe('H6 V0 — GoogleDocsConnector with stubbed fetch', () => {
  it('lists + exports each Doc and yields ImportItems', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.includes('/drive/v3/files') && !url.includes('/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                id: 'doc-A', name: 'My Doc A',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2026-04-30T12:00:00Z',
                owners: [{ emailAddress: 'alice@example.com', displayName: 'Alice A.' }],
                lastModifyingUser: { emailAddress: 'alice@example.com' },
              },
              {
                id: 'doc-B', name: 'My Doc B',
                mimeType: 'application/vnd.google-apps.document',
                modifiedTime: '2026-04-29T08:00:00Z',
                owners: [{ emailAddress: 'bob@example.com' }],
                lastModifyingUser: { emailAddress: 'bob@example.com' },
              },
            ],
          }),
          text: async () => '',
        };
      }
      // export endpoint
      return {
        ok: true,
        status: 200,
        text: async () => '# Markdown body for ' + url.split('/').slice(-2, -1)[0],
        json: async () => ({}),
      };
    });

    const oauthVault = new OAuthVault({ vault: new VaultMemory() });
    await oauthVault.storeTokens('google', null, {
      access:    'demo-google-token',
      expiresAt: Date.now() + 3600_000,
    });

    const connector = new GoogleDocsConnector({ fetchFn });
    const items = [];
    for await (const it of connector.import({ oauthVault })) items.push(it);

    expect(items).toHaveLength(2);
    expect(items[0].relPath).toBe('imports/google-docs/doc-A.md');
    expect(items[0].content).toContain('Markdown body');
    expect(items[0].contentType).toBe('text/markdown');
    expect(items[0].people.some((p) => p.kind === 'email' && p.value === 'alice@example.com')).toBe(true);
    expect(items[1].relPath).toBe('imports/google-docs/doc-B.md');
  });

  it('throws when google credentials missing access token', async () => {
    const oauthVault = new OAuthVault({ vault: new VaultMemory() });
    // Note: core.OAuthVault.storeTokens REQUIRES `access` to be truthy, so we
    // can't simulate a stored-but-empty token via the public API. Test the
    // adjacent failure mode (no tokens stored at all) which produces the same
    // NO_ACCESS_TOKEN error path in GoogleDocsConnector.
    const connector = new GoogleDocsConnector({ fetchFn: vi.fn() });
    await expect(async () => {
      for await (const _ of connector.import({ oauthVault })) {
        // not reached
      }
    }).rejects.toThrow();
  });
});
