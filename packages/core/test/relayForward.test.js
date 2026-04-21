/**
 * relay-forward skill — each policy tier accepts/denies correctly; forwards
 * payload; returns forwarded:true on success; returns error shapes on failures.
 * See EXTRACTION-PLAN.md Group M for the Tests checklist.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerRelayForward } from '../src/skills/relayForward.js';
import { DataPart, Parts, TextPart } from '../src/Parts.js';

// ── Minimal fake Agent ────────────────────────────────────────────────────────

function makeAgent({
  policy,
  peerKeys = new Set(),
  trustTier,
  groupProof,
  peers = {},
  invokeImpl,
} = {}) {
  let registeredHandler = null;
  const agent = {
    register(id, handler) {
      if (id === 'relay-forward') registeredHandler = handler;
    },
    config: {
      get: (key) => key === 'policy.allowRelayFor' ? policy : undefined,
    },
    security: {
      getPeerKey: (p) => peerKeys.has(p) ? 'peer-key-' + p : null,
      groupManager: {
        hasValidProof: async (p, gid) => groupProof?.(p, gid) ?? false,
      },
    },
    trustRegistry: {
      getTier: async (p) => trustTier?.(p) ?? 'public',
    },
    peers: {
      get: async (p) => peers[p] ?? null,
    },
    invoke: vi.fn(invokeImpl ?? (async () => [DataPart({ ok: true })])),
  };
  return { agent, invoke: () => registeredHandler };
}

// Helper to build the parts array that the skill expects
function forwardReq(targetPubKey, skill, payload = [], timeout) {
  return [DataPart({ targetPubKey, skill, payload, timeout })];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('relay-forward skill', () => {
  const CALLER = 'caller_pubkey_abc';
  const TARGET = 'target_pubkey_xyz';

  it('policy=never denies', async () => {
    const { agent, invoke } = makeAgent({ policy: 'never' });
    registerRelayForward(agent);
    const handler = invoke();
    const out = await handler({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out)).toEqual({ error: 'relay-not-enabled' });
  });

  it('policy=authenticated denies when caller has no key', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'authenticated',
      peerKeys: new Set(),
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toMatch(/not authenticated/);
  });

  it('policy=authenticated accepts a hello\'d caller and forwards', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'authenticated',
      peerKeys: new Set([CALLER]),
      peers: { [TARGET]: { reachable: true } },
      invokeImpl: async () => [TextPart('hi there')],
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo', [TextPart('hi')]), from: CALLER });
    const data = Parts.data(out);
    expect(data.forwarded).toBe(true);
    expect(Parts.text(data.parts)).toBe('hi there');
    // Origin propagation: caller pubKey should be passed through.
    expect(agent.invoke).toHaveBeenCalledWith(
      TARGET, 'echo', expect.anything(),
      expect.objectContaining({ origin: CALLER }),
    );
  });

  it('policy=trusted denies when tier < trusted', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'trusted',
      trustTier: () => 'authenticated',
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toMatch(/trust tier too low/);
  });

  it('policy=trusted accepts when tier >= trusted', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'trusted',
      trustTier: () => 'trusted',
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).forwarded).toBe(true);
  });

  it('policy=group:X accepts a valid member proof', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'group:team-a',
      groupProof: (_p, g) => g === 'team-a',
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).forwarded).toBe(true);
  });

  it('policy=group:X denies without a valid proof', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'group:team-a',
      groupProof: () => false,
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toMatch(/not a member of group team-a/);
  });

  it('policy=always bypasses all checks', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'always',
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).forwarded).toBe(true);
  });

  it('explicit opts.policy overrides agent.config', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'never',
      peers: { [TARGET]: { reachable: true } },
    });
    registerRelayForward(agent, { policy: 'always' });
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).forwarded).toBe(true);
  });

  it('returns target-unreachable when the peer is not in the graph', async () => {
    const { agent, invoke } = makeAgent({ policy: 'always', peers: {} });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toBe('target-unreachable');
  });

  it('refuses to relay to the caller (loop guard)', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'always',
      peers: { [CALLER]: { reachable: true } },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(CALLER, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toMatch(/relay-loop/);
  });

  it('returns forward-failed when the downstream invoke throws', async () => {
    const { agent, invoke } = makeAgent({
      policy: 'always',
      peers: { [TARGET]: { reachable: true } },
      invokeImpl: async () => { throw new Error('boom'); },
    });
    registerRelayForward(agent);
    const out = await invoke()({ parts: forwardReq(TARGET, 'echo'), from: CALLER });
    expect(Parts.data(out).error).toMatch(/forward-failed: boom/);
  });

  it('validates required fields', async () => {
    const { agent, invoke } = makeAgent({ policy: 'always' });
    registerRelayForward(agent);
    const handler = invoke();

    const noTarget = await handler({ parts: [DataPart({})], from: CALLER });
    expect(Parts.data(noTarget).error).toMatch(/missing targetPubKey/);

    const noSkill = await handler({ parts: [DataPart({ targetPubKey: TARGET })], from: CALLER });
    expect(Parts.data(noSkill).error).toMatch(/missing skill/);
  });
});
