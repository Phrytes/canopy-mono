/**
 * Scenario: governance/role-demote-mid-call
 *
 * Story: Bob holds the `coordinator` role in group `g1` (issued by Carol,
 * the group admin).  Bob invokes a `requiredRole: 'coordinator'` skill on
 * Carol.  WHILE Bob's call is still executing on Carol's side, the admin
 * (Carol) demotes Bob to `observer` via `setRole`.  The in-flight call
 * MUST still complete successfully — its proof was valid at invoke-time.
 * Bob's NEXT call (post-demotion) must be rejected with `INSUFFICIENT_ROLE`.
 *
 * Audit trail: Carol logs the role change to her IdentityPodStore's
 * auth-log.  Reading the log back proves the audit-trail is intact.
 *
 * Lab setup: bypassed.  The harness's Lab.boot does not wire PolicyEngine /
 * GroupManager / TrustRegistry into agents (documented as a §T.5 §Notes
 * gap), so we construct the agents manually with a shared InternalBus and
 * full permissions stack.  Same approach the protocol scenarios take when
 * they need agent options the Lab doesn't surface.
 *
 * Action:
 *   1. Carol issues Bob a `coordinator` proof for `g1`.
 *   2. Carol registers a long-running `requiredRole: { group: 'g1', role: 'coordinator' }` skill.
 *   3. Bob invokes the skill — handler awaits a "demote-now" promise so we
 *      can deterministically interleave setRole between the policy check
 *      and the handler resolving.
 *   4. While the handler is awaiting, Carol calls setRole(bob, 'observer').
 *   5. The handler resumes; the in-flight call completes.
 *   6. Bob calls the same skill again — Carol's PolicyEngine sees
 *      role=observer < required coordinator → INSUFFICIENT_ROLE.
 *
 * Assertion:
 *   - First invocation completes with the handler's result.
 *   - Second invocation throws / fails with a message tagged INSUFFICIENT_ROLE.
 *   - Carol's PolicyEngine.checkInbound directly returns code INSUFFICIENT_ROLE.
 *   - Carol's auth-log includes the role-changed event.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, InternalBus, InternalTransport, TextPart, Parts, PolicyEngine, TrustRegistry, GroupManager, SkillRegistry, defineSkill, Bootstrap } from '@canopy/core';
import { IdentityPodStore } from '@canopy/pod-client';
import { VaultMemory } from '@canopy/vault';

import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT = 'https://carol.example/';

/**
 * Build an agent with a fully-wired permissions stack.
 *
 *   identity  ──┬── trustRegistry (per-vault)
 *               ├── groupManager  (per-vault)
 *               ├── skillRegistry (shared with PolicyEngine)
 *               └── PolicyEngine  (consults all three)
 *
 * The agent's own private SkillRegistry is populated via `skills:` so the
 * handler can run; we then ALSO register the same skill in the standalone
 * SkillRegistry so PolicyEngine can read its `requiredRole` declaration.
 * (Agent.skills is private and PolicyEngine takes a registry at construction
 * time → we maintain two parallel views.  Documented as a §T.5 §Notes gap.)
 */
async function buildAgent(bus, { label, skills = [] } = {}) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const transport = new InternalTransport(bus, identity.pubKey);

  const trustRegistry = new TrustRegistry(new VaultMemory());
  const groupManager  = new GroupManager({ identity, vault });
  const skillRegistry = new SkillRegistry();
  for (const s of skills) skillRegistry.register(s);

  const policyEngine = new PolicyEngine({
    trustRegistry,
    skillRegistry,
    agentPubKey: identity.pubKey,
    groupManager,
  });

  const agent = new Agent({
    identity, transport, policyEngine, trustRegistry,
    skills, label,
  });
  await agent.start();

  return { agent, identity, vault, trustRegistry, groupManager, skillRegistry, policyEngine };
}

describe('governance/role-demote-mid-call', () => {
  let bobBundle, carolBundle;

  afterEach(async () => {
    try { await bobBundle?.agent.stop(); } catch { /* swallow */ }
    try { await carolBundle?.agent.stop(); } catch { /* swallow */ }
    bobBundle = null;
    carolBundle = null;
  });

  it('mid-call demotion: in-flight call completes; next call rejected with INSUFFICIENT_ROLE; auth-log records the change', async () => {
    const bus = new InternalBus();

    // ── Define the protected skill ─────────────────────────────────────
    // Long-running: waits on `demoteSignal` so the test can interleave
    // a setRole BETWEEN the inbound policy check and the handler resolving.
    let demoteSignalResolve;
    const demoteSignal = new Promise((r) => { demoteSignalResolve = r; });

    let handlerInvocations = 0;
    const protectedSkill = defineSkill(
      'admin-only',
      async ({ parts }) => {
        handlerInvocations += 1;
        // Wait until the test signals "go" — emulates a slow handler that
        // is mid-flight when the role change happens.
        await demoteSignal;
        // Echo the input so the assertion can confirm the result actually
        // came from THIS handler (not e.g. a default 'failed' shape).
        return [TextPart(`ok:${Parts.text(parts)}`)];
      },
      {
        visibility:   'public',
        policy:       'always-allow',
        requiredRole: { group: 'g1', role: 'coordinator' },
      },
    );

    // ── Build Carol (admin/skill-host) and Bob (caller) ────────────────
    carolBundle = await buildAgent(bus, { label: 'carol', skills: [protectedSkill] });
    bobBundle   = await buildAgent(bus, { label: 'bob' });

    // Mutual peer registration so SecurityLayer accepts requests both ways.
    carolBundle.agent.addPeer(bobBundle.agent.address,   bobBundle.identity.pubKey);
    bobBundle.agent.addPeer(carolBundle.agent.address, carolBundle.identity.pubKey);

    // Carol issues Bob a `coordinator` proof for g1.
    await carolBundle.groupManager.issueProof(
      bobBundle.identity.pubKey,
      'g1',
      { role: 'coordinator' },
    );
    expect(await carolBundle.groupManager.getRole(bobBundle.identity.pubKey, 'g1'))
      .toBe('coordinator');

    // ── Wire Carol's auth-log via IdentityPodStore + a MockPod ─────────
    const carolPod = new MockPod();
    // Bootstrap.create() returns a fresh 24-word BIP-39 phrase + bootstrap;
    // we don't need recovery here, only a valid Bootstrap instance for the
    // IdentityPodStore's auth-log encryption.
    const { bootstrap: carolBootstrap } = Bootstrap.create();
    const carolStore = new IdentityPodStore({
      podClient: carolPod,
      bootstrap: carolBootstrap,
      identity:  carolBundle.identity,
      podRoot:   POD_ROOT,
    });
    await carolStore.init();

    // ── First invocation: kick off, then demote BEFORE the handler resolves ─
    const inFlight = bobBundle.agent.invoke(
      carolBundle.agent.address,
      'admin-only',
      [TextPart('hello')],
    );

    // Yield enough turns for taskExchange to receive the request, run
    // PolicyEngine.checkInbound (which sees role=coordinator), and enter
    // the awaiting handler.
    await new Promise((r) => setTimeout(r, 20));

    // While the handler is parked, Carol demotes Bob.  Demotion happens
    // in Carol's GroupManager; the in-flight handler's policy decision
    // was already made and cannot be revisited.
    await carolBundle.groupManager.setRole(
      bobBundle.identity.pubKey,
      'g1',
      'observer',
    );
    expect(await carolBundle.groupManager.getRole(bobBundle.identity.pubKey, 'g1'))
      .toBe('observer');

    // Append the audit-trail entry to Carol's auth-log.
    await carolStore.appendAuthEvent({
      event:  'role-changed',
      actor:  carolBundle.identity.pubKey,
      target: bobBundle.identity.pubKey,
      at:     '2026-04-28T12:00:00Z',
      metadata: {
        group:    'g1',
        from:     'coordinator',
        to:       'observer',
        reason:   'mid-call-demotion-test',
      },
    });

    // Now release the parked handler.
    demoteSignalResolve();

    // The in-flight call MUST complete — the proof was valid at invoke-time.
    const result = await inFlight;
    expect(Parts.text(result)).toBe('ok:hello');
    expect(handlerInvocations).toBe(1);

    // ── Second invocation: must be rejected with INSUFFICIENT_ROLE ─────
    const err = await bobBundle.agent
      .invoke(carolBundle.agent.address, 'admin-only', [TextPart('again')])
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // The wire-protocol returns err.message; PolicyEngine's INSUFFICIENT_ROLE
    // message references the role + group.  Match on either the code (via
    // direct policy-engine check) or the descriptive message.
    expect(err.message).toMatch(/role|coordinator|observer/i);

    // The handler MUST NOT have been entered for the second call.
    expect(handlerInvocations).toBe(1);

    // Direct PolicyEngine check confirms the machine-readable code.
    const policyErr = await carolBundle.policyEngine
      .checkInbound({
        peerPubKey: bobBundle.identity.pubKey,
        skillId:    'admin-only',
        action:     'call',
      })
      .catch((e) => e);
    expect(policyErr).toBeInstanceOf(Error);
    expect(policyErr.code).toBe('INSUFFICIENT_ROLE');

    // ── Audit trail: Carol's auth-log has the role-changed event ───────
    const events = await carolStore.readAuthLog('2026-04-28T12:30:00Z');
    const roleChanged = events.find((e) => e['dw:event'] === 'role-changed');
    expect(roleChanged, 'auth-log must record the demotion').toBeTruthy();
    expect(roleChanged['dw:metadata']?.from).toBe('coordinator');
    expect(roleChanged['dw:metadata']?.to).toBe('observer');
    expect(roleChanged['dw:metadata']?.group).toBe('g1');
    expect(typeof roleChanged['dw:signature']).toBe('string');
  }, 8_000);
});
