/**
 * agent.enableAutoHello() — Group R.
 *
 * Covers the opt-in peer-discovered → hello (+ pullPeerList) wiring.
 * See EXTRACTION-PLAN.md §7 Group R and CODING-PLAN.md Group R.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph }     from '../src/discovery/PeerGraph.js';
import { Emitter }       from '../src/Emitter.js';
import { DataPart }      from '../src/Parts.js';

async function makeAgent() {
  const bus      = new InternalBus();
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent    = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    peers:     new PeerGraph(),
  });
  await agent.start();
  return agent;
}

// Tiny fake transport for the "ble" slot — we just need sendHello + emit.
function makeFakeBleTransport(address = 'ble-fake') {
  const e = new Emitter();
  e.address = address;
  e.sendHello       = vi.fn(async () => {});
  e.useSecurityLayer = () => {};
  e.setReceiveHandler = () => {};
  e.connect         = async () => {};
  e.disconnect      = async () => {};
  return e;
}

describe('agent.enableAutoHello', () => {

  it('triggers agent.hello on peer-discovered (pubKey path)', async () => {
    const agent = await makeAgent();
    agent.hello = vi.fn(async () => {});

    agent.enableAutoHello();
    agent.transport.emit('peer-discovered', 'PEER_A_PUBKEY');
    await new Promise(r => setImmediate(r));

    expect(agent.hello).toHaveBeenCalledTimes(1);
    expect(agent.hello.mock.calls[0][0]).toBe('PEER_A_PUBKEY');
    await agent.stop();
  });

  it('skips hello when SecurityLayer already has the peer key', async () => {
    const agent = await makeAgent();
    agent.addPeer('KNOWN_PEER', 'KNOWN_PEER_KEY');  // registers key in SecurityLayer
    agent.hello = vi.fn(async () => {});

    agent.enableAutoHello();
    agent.transport.emit('peer-discovered', 'KNOWN_PEER');
    await new Promise(r => setImmediate(r));

    expect(agent.hello).not.toHaveBeenCalled();
    await agent.stop();
  });

  it('sends BLE hello exactly once per MAC (dedup)', async () => {
    const agent = await makeAgent();
    const ble   = makeFakeBleTransport();
    agent.addTransport('ble', ble);

    agent.enableAutoHello();

    ble.emit('peer-discovered', 'AA:BB:CC:DD:EE:FF');
    ble.emit('peer-discovered', 'AA:BB:CC:DD:EE:FF');
    ble.emit('peer-discovered', 'AA:BB:CC:DD:EE:F0');
    await new Promise(r => setImmediate(r));

    expect(ble.sendHello).toHaveBeenCalledTimes(2);
    await agent.stop();
  });

  it('wires transports that are added after enableAutoHello', async () => {
    const agent = await makeAgent();
    agent.enableAutoHello();

    const ble = makeFakeBleTransport('late-ble');
    agent.addTransport('ble', ble);
    ble.emit('peer-discovered', 'AA:BB:CC:DD:EE:01');
    await new Promise(r => setImmediate(r));

    expect(ble.sendHello).toHaveBeenCalledTimes(1);
    await agent.stop();
  });

  it('is idempotent — second enableAutoHello() does not double-bind', async () => {
    const agent = await makeAgent();
    agent.hello = vi.fn(async () => {});

    agent.enableAutoHello();
    agent.enableAutoHello();  // second call
    agent.transport.emit('peer-discovered', 'PEER_B_PUBKEY');
    await new Promise(r => setImmediate(r));

    expect(agent.hello).toHaveBeenCalledTimes(1);
    await agent.stop();
  });

  it('calls pullPeerList when opts.pullPeers is true', async () => {
    const agent = await makeAgent();
    agent.hello  = vi.fn(async () => {});
    // When pullPeerList calls agent.invoke('peer-list', ...), give it a reply.
    agent.invoke = vi.fn(async () => [DataPart({ peers: [] })]);

    agent.enableAutoHello({ pullPeers: true });
    agent.transport.emit('peer-discovered', 'PEER_C_PUBKEY');
    await new Promise(r => setImmediate(r));

    expect(agent.hello).toHaveBeenCalledTimes(1);
    expect(agent.invoke).toHaveBeenCalled();
    // Confirm it was the peer-list skill that was invoked.
    expect(agent.invoke.mock.calls[0][1]).toBe('peer-list');
    await agent.stop();
  });

  it('does NOT call pullPeerList when opts.pullPeers is false (default)', async () => {
    const agent = await makeAgent();
    agent.hello  = vi.fn(async () => {});
    agent.invoke = vi.fn(async () => [DataPart({ peers: [] })]);

    agent.enableAutoHello();  // default pullPeers = false
    agent.transport.emit('peer-discovered', 'PEER_D_PUBKEY');
    await new Promise(r => setImmediate(r));

    expect(agent.hello).toHaveBeenCalledTimes(1);
    expect(agent.invoke).not.toHaveBeenCalled();
    await agent.stop();
  });

  it('emits auto-hello-error when hello fails (so it doesn\'t crash silently)', async () => {
    const agent = await makeAgent();
    agent.hello = vi.fn(async () => { throw new Error('hello timeout'); });

    const errors = [];
    agent.on('auto-hello-error', e => errors.push(e));

    agent.enableAutoHello();
    agent.transport.emit('peer-discovered', 'PEER_E_PUBKEY');
    await new Promise(r => setImmediate(r));

    expect(errors).toHaveLength(1);
    expect(errors[0].peer).toBe('PEER_E_PUBKEY');
    expect(errors[0].error.message).toMatch(/hello timeout/);
    await agent.stop();
  });
});
