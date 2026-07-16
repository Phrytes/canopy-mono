/**
 * H7 V0 server-side integration test.
 *
 * Migrated 2026-05-04 from the legacy `SkillRouter+EventBroadcaster+
 * supertest+POST /api/skills/:id` pattern to the new A2A wire shape:
 * the archive server is a real `core.Agent` exposed via `mountLocalUi`
 * (`POST /tasks/send`), and tests speak via `LocalAgentClient` from
 * `@onderling/agent-ui`.
 *
 * Substrate composition is still what we're testing — the archive's
 * skills run on the real SkillRegistry / taskExchange path, not on a
 * synthetic `{invokeSkill}` shim.
 *
 * The previous "auth wiring" describe block (resolveActor / actor flows
 * into ctx) is dropped — that tested the legacy SkillRouter auth model.
 * The new A2A path uses `A2AAuth` (or future `LocalUiAuth`); auth tests
 * live in `@onderling/core/test/A2A.test.js` and will be re-added at the
 * archive level once `LocalUiAuth` is wired.
 *
 * The previous "broadcaster integration" test is dropped — it tested the
 * EventBroadcaster primitive itself, not archive-specific events.
 * Archive currently emits no skill-level events; if/when it does,
 * a streaming skill via `POST /tasks/sendSubscribe` is the SDK path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart }          from '@onderling/core';
import { LocalAgentClient }  from '@onderling/agent-ui';

import { Db } from '../src/Db.js';
import { createArchiveWebServer } from '../src/server/index.js';

let db;
let server;
let client;

beforeEach(async () => {
  db = Db.open(':memory:');
  // Seed one source + a few resources so search/list have content.
  const src = db.addSource({ name: 'gmail', podRoot: 'https://x.example/gmail' });
  for (const [pod, body, ct] of [
    ['https://x.example/gmail/msg-1.md', 'Subject: meet alice friday for lunch', 'text/markdown'],
    ['https://x.example/gmail/msg-2.md', 'Subject: project update from bob',     'text/markdown'],
    ['https://x.example/gmail/msg-3.md', 'apple banana cherry',                  'text/plain'],
  ]) {
    db.upsertResource({
      sourceId:    src.id,
      podUri:      pod,
      relPath:     pod.split('/').pop(),
      contentType: ct,
      size:        body.length,
      sha256:      'sha-' + pod,
      lastModified: 1700000000000,
      ftsContent:  body,
    });
  }
  server = await createArchiveWebServer({ db, port: 0 });
  client = new LocalAgentClient({ baseUrl: server.url });
});

afterEach(async () => {
  await server.stop();
  db.close();
});

/** Pull the first DataPart's data out of a result.parts array. */
function dataOf(result) {
  const dp = result.parts.find((p) => p.type === 'DataPart');
  return dp?.data ?? null;
}

describe('H7 — agent card discovery', () => {
  it('lists archive.* skills via A2A agent-card', async () => {
    const card = await client.discoverSkills();
    const ids = card.skills.map((s) => s.id).sort();
    expect(ids).toEqual([
      'archive.get', 'archive.list', 'archive.search',
      'archive.sources', 'archive.stats',
    ]);
  });
});

describe('H7 — archive.search', () => {
  it('returns FTS5 matches via L1i PodSearchAdapter', async () => {
    const result = await client.invoke('archive.search', [DataPart({ query: 'alice', limit: 10 })]);
    const data = dataOf(result);
    expect(data.total).toBe(1);
    expect(data.items[0].relPath).toBe('msg-1.md');
    expect(data.facets.sourceName).toMatchObject({ gmail: 1 });
  });

  it('filter-only query fails (documented gap from L1i adapter)', async () => {
    await expect(
      client.invoke('archive.search', [DataPart({ filters: { contentType: 'text/markdown' } })]),
    ).rejects.toMatchObject({ code: 'SKILL_FAILED' });
  });

  it('archive.get fails on missing podUri', async () => {
    await expect(
      client.invoke('archive.get', [DataPart({})]),
    ).rejects.toMatchObject({ code: 'SKILL_FAILED' });
  });
});

describe('H7 — archive.list', () => {
  it('returns all resources when no filter', async () => {
    const result = await client.invoke('archive.list', [DataPart({})]);
    const data = dataOf(result);
    expect(data.total).toBe(3);
  });

  it('filters by sourceId', async () => {
    const sources = db.listSources();
    const result = await client.invoke('archive.list', [DataPart({ sourceId: sources[0].id })]);
    const data = dataOf(result);
    expect(data.total).toBe(3);
  });
});

describe('H7 — archive.get', () => {
  it('returns the resource + content', async () => {
    const result = await client.invoke('archive.get',
      [DataPart({ podUri: 'https://x.example/gmail/msg-1.md' })]);
    const data = dataOf(result);
    expect(data.resource).not.toBeNull();
    expect(data.resource.pod_uri ?? data.resource.podUri)
      .toBe('https://x.example/gmail/msg-1.md');
    expect(data.content).toContain('alice');
  });

  it('returns null resource for unknown podUri', async () => {
    const result = await client.invoke('archive.get',
      [DataPart({ podUri: 'https://x.example/nonexistent' })]);
    const data = dataOf(result);
    expect(data.resource).toBeNull();
  });
});

describe('H7 — archive.sources + .stats', () => {
  it('archive.sources lists registered sources with counts', async () => {
    const result = await client.invoke('archive.sources', [DataPart({})]);
    const data = dataOf(result);
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0]).toMatchObject({ name: 'gmail', itemCount: 3 });
  });

  it('archive.stats returns total + per-source counts', async () => {
    const result = await client.invoke('archive.stats', [DataPart({})]);
    const data = dataOf(result);
    expect(data.total).toBe(3);
    expect(data.perSource).toHaveLength(1);
  });
});

describe('H7 — unknown skill', () => {
  it('rejects an unregistered skill id', async () => {
    await expect(
      client.invoke('archive.does-not-exist', [DataPart({})]),
    ).rejects.toThrow();
  });
});
