/**
 * Agent.pseudoPod + makeFetchResourceSkill — unit tests.
 *
 * Standardisation Phase 50.3 — verifies:
 *   - Agent accepts an optional `pseudoPod` constructor arg.
 *   - `agent.pseudoPod` getter returns the supplied object.
 *   - With no arg, the slot is `null` (opaque slot semantics; core does
 *     not import any pseudo-pod substrate).
 *   - `makeFetchResourceSkill({read})` builds a skill that dispatches
 *     reads through the injected callback.
 *   - The skill returns a `DataPart({uri, bytes, etag?})` shape.
 *   - Error cases: NOT_FOUND (read returns null), NOT_READABLE
 *     (read throws), INVALID_ARGUMENT (missing uri).
 *   - The skill registers cleanly on an Agent via
 *     `agent.skills.register(skill)` and via
 *     `agent.register(skill.id, skill.handler, skill.opts)`.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity }     from '../src/identity/AgentIdentity.js';
import { VaultMemory }       from '@canopy/vault';
import { Agent }             from '../src/Agent.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { makeFetchResourceSkill } from '../src/skills/fetchResource.js';

async function makeAgent(extra = {}) {
  const identity  = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(new InternalBus(), identity.pubKey);
  return new Agent({ identity, transport, ...extra });
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — pseudoPod opaque slot', () => {
  it('is null by default', async () => {
    const agent = await makeAgent();
    expect(agent.pseudoPod).toBe(null);
  });

  it('stores whatever object the caller passes in', async () => {
    const fake = { read: async () => 'data', write: async () => {}, label: 'fake-pp' };
    const agent = await makeAgent({ pseudoPod: fake });
    expect(agent.pseudoPod).toBe(fake);
    expect(agent.pseudoPod.label).toBe('fake-pp');
  });

  it('does not require any substrate import to work', async () => {
    // The slot is opaque — Agent treats it as `any`. Passing literally
    // any value (a string, an array, a function) is accepted.
    const agent = await makeAgent({ pseudoPod: 'opaque-handle' });
    expect(agent.pseudoPod).toBe('opaque-handle');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('makeFetchResourceSkill — factory', () => {
  it('throws INVALID_ARGUMENT when read is not a function', async () => {
    expect(() => makeFetchResourceSkill({ read: null }))
      .toThrow(/read.*function/i);
    expect(() => makeFetchResourceSkill({}))
      .toThrow(/read.*function/i);
  });

  it("uses 'fetch-resource' as the default id", () => {
    const skill = makeFetchResourceSkill({ read: async () => 'value' });
    expect(skill.id).toBe('fetch-resource');
  });

  it('accepts an `id` override (for namespacing)', async () => {
    const skill = makeFetchResourceSkill({
      read: async () => 'value',
      id: 'pseudo-pod/fetch',
    });
    expect(skill.id).toBe('pseudo-pod/fetch');
  });

  it("defaults visibility to 'authenticated'", () => {
    const skill = makeFetchResourceSkill({ read: async () => 'value' });
    expect(skill.visibility).toBe('authenticated');
  });

  it('tags include core + pseudo-pod + storage', async () => {
    const skill = makeFetchResourceSkill({ read: async () => 'value' });
    expect(skill.tags).toEqual(expect.arrayContaining(['core', 'pseudo-pod', 'storage']));
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('makeFetchResourceSkill — handler behaviour', () => {
  function callHandler(skill, parts) {
    return skill.handler({ parts });
  }

  it('extracts uri from a DataPart and returns the read result', async () => {
    const store = new Map([['https://anne.pod/x.ttl', 'hello world']]);
    const skill = makeFetchResourceSkill({ read: async (uri) => store.get(uri) ?? null });

    const out = await callHandler(skill, [
      { type: 'DataPart', data: { uri: 'https://anne.pod/x.ttl' } },
    ]);

    expect(out).toEqual([
      { type: 'DataPart', data: { uri: 'https://anne.pod/x.ttl', bytes: 'hello world' } },
    ]);
  });

  it('accepts a naked uri in a TextPart', async () => {
    const skill = makeFetchResourceSkill({ read: async (uri) => ({ marker: uri }) });
    const out = await callHandler(skill, [
      { type: 'TextPart', text: 'pseudo-pod://device-xyz/foo' },
    ]);

    expect(out[0].data.uri).toBe('pseudo-pod://device-xyz/foo');
    expect(out[0].data.bytes).toEqual({ marker: 'pseudo-pod://device-xyz/foo' });
  });

  it('surfaces an etag when read returns {bytes, etag}', async () => {
    const skill = makeFetchResourceSkill({
      read: async () => ({ bytes: 'content', etag: '"abc123"' }),
    });
    const out = await callHandler(skill, [
      { type: 'DataPart', data: { uri: 'x' } },
    ]);
    expect(out[0].data).toEqual({
      uri: 'x',
      bytes: 'content',
      etag: '"abc123"',
    });
  });

  it('throws NOT_FOUND when read returns null', async () => {
    const skill = makeFetchResourceSkill({ read: async () => null });
    await expect(callHandler(skill, [{ type: 'DataPart', data: { uri: 'x' } }]))
      .rejects.toMatchObject({ code: 'NOT_FOUND', uri: 'x' });
  });

  it('throws NOT_FOUND when read returns undefined', async () => {
    const skill = makeFetchResourceSkill({ read: async () => undefined });
    await expect(callHandler(skill, [{ type: 'DataPart', data: { uri: 'x' } }]))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_READABLE when read throws', async () => {
    const skill = makeFetchResourceSkill({
      read: async () => { throw new Error('disk failure'); },
    });
    await expect(callHandler(skill, [{ type: 'DataPart', data: { uri: 'x' } }]))
      .rejects.toMatchObject({ code: 'NOT_READABLE', uri: 'x' });
  });

  it('throws INVALID_ARGUMENT when no uri is present', async () => {
    const skill = makeFetchResourceSkill({ read: async () => 'irrelevant' });
    await expect(callHandler(skill, [{ type: 'DataPart', data: { not: 'a uri' } }]))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(callHandler(skill, []))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('makeFetchResourceSkill — registers cleanly on an Agent', () => {
  it("via agent.skills.register(skill) — the SkillRegistry path", async () => {
    const agent = await makeAgent();
    const skill = makeFetchResourceSkill({ read: async () => 'v' });
    agent.skills.register(skill);

    const fetched = agent.skills.get(skill.id);
    expect(fetched).toBeTruthy();
    expect(fetched.id).toBe('fetch-resource');
  });

  it("via agent.register(id, handler, opts) — the convenience path", async () => {
    const agent = await makeAgent();
    const skill = makeFetchResourceSkill({ read: async () => 'v' });
    agent.register(skill.id, skill.handler, {
      visibility: skill.visibility,
      description: skill.description,
      tags: skill.tags,
    });

    expect(agent.skills.get('fetch-resource')).toBeTruthy();
  });

  it('handler executes via the registered skill', async () => {
    const agent = await makeAgent({ pseudoPod: { /* not used in this test */ } });
    const seen = [];
    const skill = makeFetchResourceSkill({
      read: async (uri) => { seen.push(uri); return 'served'; },
    });
    agent.skills.register(skill);

    const reg = agent.skills.get('fetch-resource');
    const out = await reg.handler({
      parts: [{ type: 'DataPart', data: { uri: 'q://1' } }],
    });

    expect(seen).toEqual(['q://1']);
    expect(out[0].data).toEqual({ uri: 'q://1', bytes: 'served' });
  });
});
