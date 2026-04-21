/**
 * MqttTransport tests.
 *
 * Full integration tests need a live MQTT broker and are skipped in CI.
 * Construction / static helpers run everywhere.
 *
 * To run integration tests locally (requires a running broker):
 *   MQTT_BROKER=wss://broker.hivemq.com:8884/mqtt RUN_MQTT_TESTS=1 npm test -- test/MqttTransport.test.js
 */
import { describe, it, expect } from 'vitest';
import { MqttTransport } from '../src/transport/MqttTransport.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';

const RUN_INTEGRATION = !!process.env.RUN_MQTT_TESTS;
const BROKER          = process.env.MQTT_BROKER ?? 'wss://broker.hivemq.com:8884/mqtt';

// ── Construction / static helpers ────────────────────────────────────────────

describe('MqttTransport construction', () => {
  it('throws without brokerUrl', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new MqttTransport({ identity: id })).toThrow(/brokerUrl/);
  });

  it('deriveAddress produces a deterministic 24-char hex string', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const addr1 = MqttTransport.deriveAddress(id);
    const addr2 = MqttTransport.deriveAddress(id);
    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^[0-9a-f]{24}$/);
  });

  it('two different identities produce different addresses', async () => {
    const id1 = await AgentIdentity.generate(new VaultMemory());
    const id2 = await AgentIdentity.generate(new VaultMemory());
    expect(MqttTransport.deriveAddress(id1)).not.toBe(MqttTransport.deriveAddress(id2));
  });

  it('address exposed on transport instance', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new MqttTransport({ brokerUrl: BROKER, identity: id });
    expect(t.address).toBe(MqttTransport.deriveAddress(id));
  });
});

// ── Integration (live broker — skip in CI) ────────────────────────────────────

describe.skipIf(!RUN_INTEGRATION)('MqttTransport integration (requires broker)', () => {
  it('connects, subscribes, publishes, receives a message', async () => {
    const id1 = await AgentIdentity.generate(new VaultMemory());
    const id2 = await AgentIdentity.generate(new VaultMemory());
    const t1  = new MqttTransport({ brokerUrl: BROKER, identity: id1 });
    const t2  = new MqttTransport({ brokerUrl: BROKER, identity: id2 });

    await Promise.all([t1.connect(), t2.connect()]);

    const received = new Promise(resolve => t2.setReceiveHandler(resolve));

    await t1._put(t2.address, {
      _v: 1, _p: 'OW', _id: 'mqtt-test', _re: null,
      _from: t1.address, _to: t2.address,
      _topic: null, _ts: Date.now(), _sig: null,
      payload: { type: 'hello' },
    });

    const env = await received;
    expect(env.payload.type).toBe('hello');

    await t1.disconnect(); await t2.disconnect();
  }, 30_000);
});
