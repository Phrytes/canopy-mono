/**
 * RelayAgent tests — lifecycle, built-in skills, and end-to-end message exchange.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { RelayAgent } from '../src/RelayAgent.js';
import {
  AgentIdentity, VaultMemory,
  Agent, RelayTransport,
  TextPart, DataPart, Parts,
} from '@canopy/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeRelay(opts = {}) {
  const relay = await RelayAgent.create({ port: 0, ...opts });
  await relay.start();
  return relay;
}

async function makeAgent(relayUrl) {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const transport = new RelayTransport({ relayUrl, identity: id });
  const agent     = new Agent({ identity: id, transport });
  await agent.start();
  return agent;
}

/** Register mutual pubKeys so both sides can encrypt/decrypt without hello. */
function link(a, b) {
  a.addPeer(b.address, b.pubKey);
  b.addPeer(a.address, a.pubKey);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('RelayAgent lifecycle', () => {
  it('creates with a generated identity', async () => {
    const relay = await RelayAgent.create({ port: 0 });
    expect(relay.pubKey).toBeTypeOf('string');
    expect(relay.pubKey.length).toBeGreaterThan(10);
    await relay.start();
    await relay.stop();
  });

  it('accepts a provided identity', async () => {
    const id    = await AgentIdentity.generate(new VaultMemory());
    const relay = await RelayAgent.create({ port: 0, identity: id });
    expect(relay.pubKey).toBe(id.pubKey);
    await relay.start();
    await relay.stop();
  });

  it('exposes a bound port after start()', async () => {
    const relay = await makeRelay();
    expect(relay.port).toBeTypeOf('number');
    expect(relay.port).toBeGreaterThan(0);
    await relay.stop();
  });

  it('stop() closes the WebSocket server (port becomes null)', async () => {
    const relay = await makeRelay();
    const port  = relay.port;
    await relay.stop();
    expect(relay.port).toBeNull();
    await expect(
      new Promise((_, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.once('error', reject);
        ws.once('open', () => { ws.close(); reject(new Error('should not connect')); });
      })
    ).rejects.toThrow();
  });
});

// ── Built-in skills ───────────────────────────────────────────────────────────

describe('RelayAgent built-in skills', () => {
  let relay, agentA;

  beforeEach(async () => {
    relay  = await makeRelay();
    agentA = await makeAgent(`ws://localhost:${relay.port}`);
    link(agentA, relay);
    await new Promise(r => setTimeout(r, 100));
  });

  afterEach(async () => {
    await agentA.stop();
    await relay.stop();
  });

  it('relay-info returns connectedPeers count and offlineQueue flag', async () => {
    const parts = await agentA.invoke(relay.address, 'relay-info', []);
    const info  = Parts.data(parts);
    expect(info.connectedPeers).toBeGreaterThanOrEqual(1);
    expect(info.offlineQueue).toBe(true);
    expect(info.mode).toBeDefined();
  });

  it('relay-peer-list returns connected addresses in accept_all mode', async () => {
    const parts        = await agentA.invoke(relay.address, 'relay-peer-list', []);
    const { peers }    = Parts.data(parts);
    expect(peers).toBeInstanceOf(Array);
    expect(peers).toContain(agentA.address);
  });

  it('relay-peer-list returns empty array in whitelist mode', async () => {
    await agentA.stop();
    await relay.stop();
    relay  = await RelayAgent.create({ port: 0, policy: { mode: 'whitelist' } });
    await relay.start();
    agentA = await makeAgent(`ws://localhost:${relay.port}`);
    link(agentA, relay);
    await new Promise(r => setTimeout(r, 100));

    const parts     = await agentA.invoke(relay.address, 'relay-peer-list', []);
    const { peers } = Parts.data(parts);
    expect(peers).toEqual([]);
  });
});

// ── End-to-end message exchange ───────────────────────────────────────────────

describe('RelayAgent end-to-end message exchange', () => {
  let relay, agentA, agentB;

  beforeEach(async () => {
    relay  = await makeRelay();
    const url = `ws://localhost:${relay.port}`;
    agentA = await makeAgent(url);
    agentB = await makeAgent(url);
    link(agentA, agentB);
    await new Promise(r => setTimeout(r, 150));
  });

  afterEach(async () => {
    await agentA.stop();
    await agentB.stop();
    await relay.stop();
  });

  it('agent A can call a skill on agent B through the relay', async () => {
    agentB.register('echo', async ({ parts }) => parts);
    const result = await agentA.invoke(agentB.address, 'echo', [TextPart('relay test')]);
    expect(Parts.text(result)).toBe('relay test');
  });

  it('bidirectional concurrent skill calls work', async () => {
    agentA.register('ping', async () => [TextPart('pong-a')]);
    agentB.register('ping', async () => [TextPart('pong-b')]);

    const taskA = agentA.call(agentB.address, 'ping', []);
    const taskB = agentB.call(agentA.address, 'ping', []);
    const [ra, rb] = await Promise.all([taskA.done(), taskB.done()]);

    expect(Parts.text(ra.parts)).toBe('pong-b');
    expect(Parts.text(rb.parts)).toBe('pong-a');
  });

  it('DataPart round-trip through relay', async () => {
    agentB.register('add', async ({ parts }) => {
      const { a, b } = Parts.data(parts) ?? {};
      return [DataPart({ result: a + b })];
    });
    const result = await agentA.invoke(agentB.address, 'add', [DataPart({ a: 10, b: 32 })]);
    expect(Parts.data(result).result).toBe(42);
  });
});
