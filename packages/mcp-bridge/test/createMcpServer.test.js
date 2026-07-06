/**
 * createMcpServer.test.js — the injected-transport seam over a mock loopback.
 *
 * Drives tools/list + tools/call through `createMcpServer` wired to an
 * in-memory loopback pair (NO real stdio/HTTP/SSE — that's DEFERRED). Proves
 * the server advertises the manifest's tools and that an inbound tools/call
 * still runs THROUGH the gate (authorized runs; unknown → MCP error).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory }          from '@canopy/vault';
import {
  Agent, AgentIdentity,
  InternalBus, InternalTransport,
  TrustRegistry, PolicyEngine, TokenRegistry,
  TextPart, Parts,
} from '@canopy/core';
import {
  RemoteHandlerRegistry,
  grantRemoteCapability,
} from '@canopy/secure-agent';
import { createMcpServer, createLoopbackPair } from '../src/index.js';

const MANIFEST = {
  app: 'demo',
  operations: [
    { id: 'op.compute', verb: 'add', appliesTo: { type: 'task' },
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Compute a thing.' } } },
  ],
};

async function makeTierWithServer() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: idA, transport: new InternalTransport(bus, idA.pubKey), tokenRegistry: new TokenRegistry(new VaultMemory()) });
  const trB   = new TrustRegistry(new VaultMemory());
  const bob   = new Agent({ identity: idB, transport: new InternalTransport(bus, idB.pubKey), trustRegistry: trB });
  alice.addPeer(bob.address, bob.pubKey); bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  const calls = { n: 0 };
  bob.register('remote.compute', async (ctx) => {
    calls.n++;
    const args = Parts.data(ctx.parts) || {};
    return [TextPart(`ran:${args.text ?? ''}`)];
  }, { visibility: 'authenticated', policy: 'requires-token' });

  const pe = new PolicyEngine({ trustRegistry: trB, skillRegistry: bob.skills, agentPubKey: bob.pubKey });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });
  await trB.setTier(alice.pubKey, 'authenticated');
  await trB.setTier(bob.pubKey,   'trusted');

  const registry = new RemoteHandlerRegistry();
  registry.register('op.compute', { remoteAddress: bob.address, skillId: 'remote.compute' });

  const { server, client } = createLoopbackPair();
  createMcpServer({ agent: alice, manifest: MANIFEST, transport: server, dispatch: { registry } });

  return { alice, bob, client, registry, calls, skillId: 'remote.compute' };
}

describe('createMcpServer — over an injected loopback transport', () => {
  it('tools/list returns the projected manifest tools', async () => {
    const { alice, bob, client } = await makeTierWithServer();
    const reply = await client.request({ method: 'tools/list' });
    expect(reply.result.tools.map((t) => t.name)).toEqual(['op.compute']);
    expect(reply.result.tools[0].inputSchema.required).toEqual(['text']);
    await alice.stop(); await bob.stop();
  });

  it('tools/call (authorized) runs through the gate and returns the MCP result', async () => {
    const { alice, bob, client, skillId, calls } = await makeTierWithServer();
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    const reply = await client.request({ method: 'tools/call', params: { name: 'op.compute', arguments: { text: 'yo' } } });
    expect(reply.result.isError).toBeUndefined();
    expect(reply.result.content[0]).toEqual({ type: 'text', text: 'ran:yo' });
    expect(calls.n).toBe(1);
    await alice.stop(); await bob.stop();
  });

  it('tools/call (ungranted) returns an MCP error, skill not executed', async () => {
    const { alice, bob, client, calls } = await makeTierWithServer();
    const reply = await client.request({ method: 'tools/call', params: { name: 'op.compute', arguments: { text: 'x' } } });
    expect(reply.result.isError).toBe(true);
    expect(calls.n).toBe(0);
    await alice.stop(); await bob.stop();
  });

  it('tools/call for a tool not in the manifest → MCP unknown-tool error', async () => {
    const { alice, bob, client, calls } = await makeTierWithServer();
    const reply = await client.request({ method: 'tools/call', params: { name: 'op.rogue', arguments: {} } });
    expect(reply.result.isError).toBe(true);
    expect(reply.result._meta.code).toBe('unknown_tool');
    expect(calls.n).toBe(0);
    await alice.stop(); await bob.stop();
  });

  it('unknown method → MCP error', async () => {
    const { alice, bob, client } = await makeTierWithServer();
    const reply = await client.request({ method: 'resources/list' });
    expect(reply.result.isError).toBe(true);
    expect(reply.result._meta.code).toBe('unknown_method');
    await alice.stop(); await bob.stop();
  });
});
