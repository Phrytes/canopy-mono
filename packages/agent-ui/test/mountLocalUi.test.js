/**
 * mountLocalUi + LocalAgentClient — end-to-end on a real core.Agent.
 *
 * This test validates the new (Phase 3) substrate primitives:
 *   - mountLocalUi binds a 127.0.0.1 A2A server over a real Agent.
 *   - LocalAgentClient speaks A2A's wire shape and round-trips a skill call.
 *
 * No synthetic {invokeSkill} shape; no SkillRouter. All dispatch goes
 * through core.taskExchange.handleTaskRequest, the real path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Agent, AgentIdentity, InternalBus, InternalTransport, TextPart, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { mountLocalUi }     from '../src/server/mountLocalUi.js';
import { LocalAgentClient } from '../src/client/LocalAgentClient.js';

async function makeAgent(label = 'TestAgent') {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, id.pubKey);
  const agent     = new Agent({ identity: id, transport, label });
  await agent.start();
  return agent;
}

describe('mountLocalUi + LocalAgentClient', () => {
  let agent;
  let ui;

  beforeEach(async () => {
    agent = await makeAgent();
  });

  afterEach(async () => {
    if (ui) await ui.stop();
    if (agent) await agent.stop();
  });

  it('mounts on 127.0.0.1 with an OS-assigned port', async () => {
    ui = await mountLocalUi(agent, { port: 0 });
    expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ui.port).toBeGreaterThan(0);
    expect(typeof ui.stop).toBe('function');
  });

  it('round-trips a skill via the A2A wire shape', async () => {
    agent.register('echo', async ({ parts }) => parts, {
      description: 'echo skill',
      visibility:  'public',
    });
    ui = await mountLocalUi(agent, { port: 0 });

    const client = new LocalAgentClient({ baseUrl: ui.url });
    const result = await client.invoke('echo', [TextPart('hello world')]);

    expect(result.status).toBe('completed');
    // Echo skill returns the same parts back. Parts are
    // {type: 'TextPart', text} per Parts.js.
    const parts = result.parts;
    expect(parts.length).toBeGreaterThan(0);
    const text = parts.find(p => p.type === 'TextPart');
    expect(text?.text).toBe('hello world');
  });

  it('round-trips a JSON DataPart', async () => {
    agent.register('addOne', async ({ parts }) => {
      const dp = parts.find(p => p.type === 'DataPart');
      const n  = dp?.data?.n ?? 0;
      return [DataPart({ n: n + 1 })];
    });
    ui = await mountLocalUi(agent, { port: 0 });

    const client = new LocalAgentClient({ baseUrl: ui.url });
    const result = await client.invoke('addOne', [DataPart({ n: 41 })]);

    expect(result.status).toBe('completed');
    const dp = result.parts.find(p => p.type === 'DataPart');
    expect(dp?.data?.n).toBe(42);
  });

  it('discoverSkills returns the agent card', async () => {
    agent.register('public-one', async () => [], { visibility: 'public' });
    ui = await mountLocalUi(agent, { port: 0 });

    const client = new LocalAgentClient({ baseUrl: ui.url });
    const card   = await client.discoverSkills();
    expect(card).toBeDefined();
    expect(card.skills).toBeInstanceOf(Array);
    expect(card.skills.some(s => s.id === 'public-one')).toBe(true);
  });

  it('failed skill surfaces as SKILL_FAILED', async () => {
    agent.register('boom', async () => {
      throw new Error('oops');
    });
    ui = await mountLocalUi(agent, { port: 0 });

    const client = new LocalAgentClient({ baseUrl: ui.url });
    await expect(client.invoke('boom', [])).rejects.toMatchObject({
      code: 'SKILL_FAILED',
    });
  });

  it('rejects synthetic agent shapes (no .register / .skills)', async () => {
    const fakeAgent = { invokeSkill: async () => ({}) };
    await expect(mountLocalUi(fakeAgent, { port: 0 }))
      .rejects.toThrow(/synthetic.*not supported|core\.Agent/i);
  });

  it('binds 127.0.0.1 by default — no LAN exposure', async () => {
    ui = await mountLocalUi(agent, { port: 0 });
    // serverPort is set; address starts with 127.0.0.1
    expect(ui.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('honours an explicit host override', async () => {
    ui = await mountLocalUi(agent, { port: 0, host: '127.0.0.1' });
    expect(ui.url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
