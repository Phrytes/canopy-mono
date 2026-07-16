import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureMeshAgent } from '../src/createSecureMeshAgent.js';

// Minimal Transport-shaped fake the secure-mesh can inject + secure.
function fakeTransport(address) {
  return {
    address,
    _secured: null,
    _connected: false,
    useSecurityLayer(layer) { this._secured = layer; },
    on() { /* 'envelope' */ },
    async connect()    { this._connected = true; },
    async disconnect() { this._connected = false; },
  };
}

describe('createSecureMeshAgent (T5.3 — unified secure-mesh factory)', () => {
  it('is a secure-agent with the unified router + the transport seams', async () => {
    const sa = await createSecureMeshAgent({ vault: new VaultMemory() });
    expect(sa.agent.routing).toBeTruthy();              // T5.1 unified router
    expect(typeof sa.addSecureTransport).toBe('function');
    expect(typeof sa.enableSecureRendezvous).toBe('function');
    expect(typeof sa.peer.connect).toBe('function');    // nkn/relay still on-demand
    await sa.shutdown();
  });

  it('injects caller-provided transports — security-wrapped + on the unified router', async () => {
    const mdns = fakeTransport('mdns.local.1');
    const ble  = fakeTransport('ble.mac.2');
    const sa = await createSecureMeshAgent({ vault: new VaultMemory(), transports: { mdns, ble } });
    // both got the SAME security layer (makeReceiveHandler), both connected.
    expect(mdns._secured).toBe(sa.agent.security);
    expect(ble._secured).toBe(sa.agent.security);
    expect(mdns._connected && ble._connected).toBe(true);
    // both registered on the unified router → the highest-priority reachable one is picked.
    const sel = await sa.agent.routing.selectTransport('peer-x');
    expect(['mdns', 'ble']).toContain(sel?.name);
    expect(sel?.name).toBe('mdns');                     // mdns > ble in TRANSPORT_PRIORITY
    await sa.shutdown();
  });

  it('a failing transport never aborts the agent (best-effort inject)', async () => {
    const bad = { /* no connect/useSecurityLayer → addSecureTransport throws */ };
    const good = fakeTransport('mdns.local.9');
    const errs = [];
    const sa = await createSecureMeshAgent({
      vault: new VaultMemory(),
      transports: { ble: bad, mdns: good },
      onTransportError: (name) => errs.push(name),
    });
    expect(errs).toContain('ble');                      // bad one reported, not thrown
    expect((await sa.agent.routing.selectTransport('p')).name).toBe('mdns');   // good one is live
    await sa.shutdown();
  });
});
