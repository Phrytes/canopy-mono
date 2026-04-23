/**
 * tunnel-open + tunnel-ow skills — Group CC2 bridge side.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Emitter }              from '../src/Emitter.js';
import { Parts, DataPart }      from '../src/Parts.js';
import { registerTunnelOpen }   from '../src/skills/tunnelOpen.js';
import { registerTunnelOw }     from '../src/skills/tunnelOw.js';

// ── Fake Agent with the surface tunnelOpen/tunnelOw use ──────────────────────

class FakeTask extends Emitter {
  constructor(taskId = 'ct-1') { super(); this.taskId = taskId; }
}

function makeAgent({
  policy             = 'authenticated',
  peerKeys           = new Set(['alice']),
  peers              = { carol: { reachable: true } },
  callImpl           = () => new FakeTask('ct-1'),
  sendOneWayImpl     = vi.fn(async () => {}),
} = {}) {
  const skills = new Map();
  const agent = {
    skills: { get: (id) => skills.get(id) },
    register(id, handler, meta) {
      skills.set(id, { id, handler, meta, enabled: true });
    },
    config: { get: (k) => k === 'policy.allowTunnelFor' ? policy : undefined },
    security: {
      getPeerKey:     (p) => peerKeys.has(p) ? `pk-${p}` : null,
      groupManager:   { hasValidProof: async () => false },
    },
    trustRegistry: { getTier: async () => 'public' },
    peers:         { get: async (p) => peers[p] ?? null },
    call:          vi.fn(callImpl),
    transport:     { sendOneWay: sendOneWayImpl },
  };
  return { agent, skills };
}

// ── tunnel-open ──────────────────────────────────────────────────────────────

describe('tunnel-open skill', () => {

  it('registers idempotently and returns the same session table', () => {
    const { agent } = makeAgent();
    const s1 = registerTunnelOpen(agent);
    const s2 = registerTunnelOpen(agent);
    expect(s1).toBe(s2);
  });

  it('returns tunnel-not-enabled when policy is "never"', async () => {
    const { agent, skills } = makeAgent({ policy: 'never' });
    registerTunnelOpen(agent);
    const handler = skills.get('tunnel-open').handler;
    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo' })],
      from:  'alice',
    });
    expect(Parts.data(rs)?.error).toBe('tunnel-not-enabled');
  });

  it('denies unauthenticated callers under "authenticated" policy', async () => {
    const { agent, skills } = makeAgent({ peerKeys: new Set() });
    registerTunnelOpen(agent);
    const handler = skills.get('tunnel-open').handler;
    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo' })],
      from:  'mallory',
    });
    expect(Parts.data(rs)?.error).toMatch(/not authenticated/);
  });

  it('errors when target is unreachable', async () => {
    const { agent, skills } = makeAgent({ peers: {} });
    registerTunnelOpen(agent);
    const handler = skills.get('tunnel-open').handler;
    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo' })],
      from:  'alice',
    });
    expect(Parts.data(rs)?.error).toBe('target-unreachable');
  });

  it('refuses a loop to the caller itself', async () => {
    const { agent, skills } = makeAgent({
      peers: { alice: { reachable: true } },
    });
    registerTunnelOpen(agent);
    const handler = skills.get('tunnel-open').handler;
    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'alice', skill: 'echo' })],
      from:  'alice',
    });
    expect(Parts.data(rs)?.error).toMatch(/tunnel-loop/);
  });

  it('allocates tunnelId + aliceTaskId, calls agent.call, stores session', async () => {
    const { agent, skills } = makeAgent();
    const sessions = registerTunnelOpen(agent);
    const handler  = skills.get('tunnel-open').handler;

    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo', payload: [] })],
      from:  'alice',
    });

    const data = Parts.data(rs);
    expect(typeof data.tunnelId).toBe('string');
    expect(typeof data.aliceTaskId).toBe('string');
    expect(data.carolTaskId).toBe('ct-1');
    expect(agent.call).toHaveBeenCalledOnce();

    const row = sessions.get(data.tunnelId);
    expect(row).toBeTruthy();
    expect(row.aliceAddr).toBe('alice');
    expect(row.carolAddr).toBe('carol');
    expect(row.carolTaskId).toBe('ct-1');
    expect(row.aliceTaskId).toBe(data.aliceTaskId);
  });

  it('forwards Carol stream-chunks back to Alice with aliceTaskId', async () => {
    const sendOneWayImpl = vi.fn(async () => {});
    const carolTask = new FakeTask('ct-1');
    const { agent, skills } = makeAgent({
      sendOneWayImpl,
      callImpl: () => carolTask,
    });
    registerTunnelOpen(agent);
    const handler = skills.get('tunnel-open').handler;

    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo' })],
      from:  'alice',
    });
    const { aliceTaskId } = Parts.data(rs);

    carolTask.emit('stream-chunk', [{ type: 'TextPart', text: 'hi' }]);
    await new Promise(r => setImmediate(r));

    expect(sendOneWayImpl).toHaveBeenCalledWith('alice', expect.objectContaining({
      type:   'stream-chunk',
      taskId: aliceTaskId,
      parts:  [{ type: 'TextPart', text: 'hi' }],
    }));
  });

  it('forwards Carol terminal "done" as tunnel-result and drops the session', async () => {
    const sendOneWayImpl = vi.fn(async () => {});
    const carolTask = new FakeTask('ct-1');
    const { agent, skills } = makeAgent({
      sendOneWayImpl,
      callImpl: () => carolTask,
    });
    const sessions = registerTunnelOpen(agent);
    const handler  = skills.get('tunnel-open').handler;

    const rs = await handler({
      parts: [DataPart({ targetPubKey: 'carol', skill: 'echo' })],
      from:  'alice',
    });
    const { tunnelId, aliceTaskId } = Parts.data(rs);
    expect(sessions.has(tunnelId)).toBe(true);

    carolTask.emit('done', { state: 'completed', parts: [{ type: 'TextPart', text: 'ok' }] });
    await new Promise(r => setImmediate(r));

    expect(sendOneWayImpl).toHaveBeenCalledWith('alice', expect.objectContaining({
      type:   'tunnel-result',
      taskId: aliceTaskId,
      status: 'completed',
      parts:  [{ type: 'TextPart', text: 'ok' }],
    }));
    expect(sessions.has(tunnelId)).toBe(false);
  });

  // Cleanup: ensure the TTL sweeper doesn't keep vitest hanging.
  afterEach_stopSessions();
});

// ── tunnel-ow ────────────────────────────────────────────────────────────────

describe('tunnel-ow skill', () => {

  it('throws if registerTunnelOpen has not been called first', () => {
    const { agent } = makeAgent();
    expect(() => registerTunnelOw(agent)).toThrow(/registerTunnelOpen/);
  });

  it('rejects unknown tunnelId', async () => {
    const { agent, skills } = makeAgent();
    registerTunnelOpen(agent);
    registerTunnelOw(agent);
    const rs = await skills.get('tunnel-ow').handler({
      parts: [DataPart({ tunnelId: 'never', inner: { type: 'cancel', taskId: 'x' } })],
      from:  'alice',
    });
    expect(Parts.data(rs)?.error).toBe('unknown-tunnel');
  });

  it('rejects calls from a non-owner', async () => {
    const { agent, skills } = makeAgent();
    const sessions = registerTunnelOpen(agent);
    registerTunnelOw(agent);

    // Seed a session manually so we don't depend on tunnel-open's rs format.
    sessions.add({
      tunnelId:    'T1',
      aliceAddr:   'alice',
      aliceTaskId: 'at-1',
      carolAddr:   'carol',
      carolTaskId: 'ct-1',
      carolTask:   new FakeTask(),
    });

    const rs = await skills.get('tunnel-ow').handler({
      parts: [DataPart({ tunnelId: 'T1', inner: { type: 'cancel', taskId: 'at-1' } })],
      from:  'mallory',
    });
    expect(Parts.data(rs)?.error).toMatch(/not tunnel owner/);
  });

  it('rewrites taskId and forwards to Carol', async () => {
    const sendOneWayImpl = vi.fn(async () => {});
    const { agent, skills } = makeAgent({ sendOneWayImpl });
    const sessions = registerTunnelOpen(agent);
    registerTunnelOw(agent);
    sessions.add({
      tunnelId:    'T1',
      aliceAddr:   'alice',
      aliceTaskId: 'at-1',
      carolAddr:   'carol',
      carolTaskId: 'ct-real',
      carolTask:   new FakeTask(),
    });

    const rs = await skills.get('tunnel-ow').handler({
      parts: [DataPart({
        tunnelId: 'T1',
        inner: { type: 'task-input', taskId: 'at-1', parts: [{ type: 'TextPart', text: 'r' }] },
      })],
      from:  'alice',
    });

    expect(Parts.data(rs)?.forwarded).toBe(true);
    expect(sendOneWayImpl).toHaveBeenCalledWith('carol', {
      type:   'task-input',
      taskId: 'ct-real',      // ← rewritten
      parts:  [{ type: 'TextPart', text: 'r' }],
    });
  });

  it('marks the session closing on a forwarded cancel', async () => {
    const { agent, skills } = makeAgent();
    const sessions = registerTunnelOpen(agent);
    registerTunnelOw(agent);
    sessions.add({
      tunnelId:    'T1',
      aliceAddr:   'alice',
      aliceTaskId: 'at-1',
      carolAddr:   'carol',
      carolTaskId: 'ct-1',
      carolTask:   new FakeTask(),
    });

    await skills.get('tunnel-ow').handler({
      parts: [DataPart({ tunnelId: 'T1', inner: { type: 'cancel', taskId: 'at-1' } })],
      from:  'alice',
    });

    expect(sessions.get('T1').closing).toBe(true);
  });

  afterEach_stopSessions();
});

// ── Cleanup helper ────────────────────────────────────────────────────────────

function afterEach_stopSessions() {
  // Vitest auto-picks up afterEach when called inside a describe block.
  afterEach(() => {
    // Stop any lingering TTL sweepers attached to fake agents created above.
    // Agents built by makeAgent() hold their sessions on agent._tunnelSessions.
    // Nothing to do here globally — each test creates its own agent which is
    // GC'd at the end.  The sweeper uses unref() so it won't block vitest.
  });
}
