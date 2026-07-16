/**
 * createArchiveAgent — build a real `core.Agent` with archive.* skills
 * registered as `defineSkill` definitions.
 *
 * Migrated 2026-05-04 from the synthetic-`{invokeSkill}` shape (deleted
 * in L1d Phase 3.1) to a real `core.Agent` over `InternalTransport`.
 * Skill handlers receive `({parts, from, agent})` per the SDK convention;
 * the wire convention is "a single DataPart whose `data` carries the
 * JSON args, returning a JSON object that SkillRegistry auto-wraps".
 */

import { Agent, AgentIdentity, InternalBus, InternalTransport, defineSkill } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { search, findByPodUri } from '../Search.js';

/** Read the first DataPart's `data` from a Parts[] input. Defaults to `{}`. */
function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {import('../Db.js').Db} args.db
 * @param {import('@onderling/pod-search').PodSearch} [args.podSearch]
 *   Optional — when supplied, archive.search delegates through L1i's
 *   API surface (uses the PodSearchAdapter shape).  When omitted,
 *   `archive.search` calls Search.js directly (legacy path).
 * @param {object} [args.identity]   pre-built AgentIdentity (tests)
 * @param {object} [args.transport]  transport for `core.Agent` (default: InternalTransport)
 * @param {string} [args.label='ArchiveAgent']
 * @returns {Promise<{ agent: Agent }>}
 */
export async function createArchiveAgent({
  db,
  podSearch,
  identity,
  transport,
  label = 'ArchiveAgent',
}) {
  if (!db) throw new TypeError('createArchiveAgent: db required');

  const id  = identity ?? await AgentIdentity.generate(new VaultMemory());
  const tx  = transport ?? new InternalTransport(new InternalBus(), id.pubKey);
  const agent = new Agent({ identity: id, transport: tx, label });

  agent.skills.register(defineSkill('archive.search', async ({ parts }) => {
    const a = dataArgs(parts);
    if (podSearch) {
      return podSearch.query({
        text:    a.query,
        filters: a.filters,
        rank:    a.rank,
        limit:   a.limit,
        offset:  a.offset,
      });
    }
    const items = search(db, a.query ?? '', {
      limit:    a.limit ?? 20,
      sourceId: a.filters?.sourceId ?? null,
    });
    return { items, total: items.length, facets: {} };
  }, {
    description: 'Full-text search over indexed pod content (FTS5 + facets).',
    visibility:  'public',
  }));

  agent.skills.register(defineSkill('archive.list', async ({ parts }) => {
    const a = dataArgs(parts);
    if (a?.sourceId) {
      const items = db.resourcesForSource(a.sourceId);
      return { items, total: items.length };
    }
    const sources = db.listSources();
    const items = sources.flatMap((s) => db.resourcesForSource(s.id));
    return { items, total: items.length };
  }, {
    description: 'List indexed resources, optionally per-source.',
    visibility:  'public',
  }));

  agent.skills.register(defineSkill('archive.get', async ({ parts }) => {
    const a = dataArgs(parts);
    if (!a?.podUri) {
      throw Object.assign(new Error('archive.get: podUri required'), { code: 'BAD_REQUEST' });
    }
    const resource = findByPodUri(db, a.podUri);
    if (!resource) return { resource: null };
    const content = db.getFtsContent(resource.id);
    return { resource, ...(typeof content === 'string' ? { content } : {}) };
  }, {
    description: 'Fetch one resource record + its FTS content by podUri.',
    visibility:  'public',
  }));

  agent.skills.register(defineSkill('archive.sources', async () => {
    const sources = db.listSources().map((s) => ({
      id:        s.id,
      name:      s.name,
      podRoot:   s.pod_root,
      addedAt:   s.added_at,
      lastSync:  s.last_indexed,
      itemCount: db.countResources(s.id),
    }));
    return { sources };
  }, {
    description: 'List registered archive sources with counts.',
    visibility:  'public',
  }));

  agent.skills.register(defineSkill('archive.stats', async () => {
    const total = db.countResources();
    const perSource = db.listSources().map((s) => ({
      id:    s.id,
      name:  s.name,
      count: db.countResources(s.id),
    }));
    return { total, perSource };
  }, {
    description: 'Total resource count + per-source counts.',
    visibility:  'public',
  }));

  await agent.start();

  return { agent };
}
