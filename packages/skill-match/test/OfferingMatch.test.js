/**
 * OfferingMatch — substrate tests (post-Phase 4.2 refactor).
 *
 * The substrate now consumes a real `core.Agent` and routes through
 * `core.protocol.pubSub`. Tests use two-or-more `Agent` instances over
 * a shared `InternalBus` (the same fixture pattern `core/test/A2A.test.js`
 * uses for in-process pairs).
 *
 * The pre-2026-05-04 `InMemoryTransport` was deleted in Phase 4.2.
 */

import { describe, it, expect, vi } from 'vitest';

import { Agent, AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { OfferingMatch } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

/** Spin up a fresh core.Agent over a shared bus. */
async function makeCoreAgent(bus, label) {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(bus, id.pubKey);
  const agent     = new Agent({ identity: id, transport, label });
  await agent.start();
  return agent;
}

/**
 * Convenience: build a OfferingMatch over a fresh agent + connect it to peers
 * already in the same group. Caller is responsible for `start()`/`stop()`.
 */
async function makeOfferingMatch({ bus, label, group, actor, offerings, posture, peers = [] }) {
  const agent = await makeCoreAgent(bus, label);
  const sm    = new OfferingMatch({
    agent,
    peers: peers.map((a) => ({ pubKey: a.address })),
    group,
    localActor: actor,
    offerings, posture,
  });
  return { agent, sm };
}

/**
 * After all agents exist, every OfferingMatch needs to know about every other
 * agent (closed-group all-to-all subscriptions). This wires that for tests.
 *
 * Also calls `core.Agent.addPeer(addr, pubKey)` on each agent so the
 * SecurityLayer recognises peers before any sendOneWay (else
 * `UNKNOWN_RECIPIENT — send HI first` fires when pubSub.subscribe sends
 * its initial subscribe envelope).
 */
function wirePeers(skillMatches) {
  const agents = skillMatches.map((x) => x.agent);
  for (const { sm, agent: self } of skillMatches) {
    for (const peer of agents) {
      if (peer === self) continue;
      self.addPeer(peer.address, peer.pubKey);
      sm.addPeer({ pubKey: peer.address });
    }
  }
}

async function tearDown(skillMatches) {
  for (const { sm, agent } of skillMatches) {
    await sm.stop();
    await agent.stop();
  }
}

describe('OfferingMatch — basic broadcast / subscribe', () => {
  it('routes a request to a matching skill-holder; claim flows back', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({
      bus, label: 'Anne', group: 'household-1', actor: ANNE,
    });
    const subscriber = await makeOfferingMatch({
      bus, label: 'the author', group: 'household-1', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    wirePeers([broadcaster, subscriber]);
    await broadcaster.sm.start();
    await subscriber.sm.start();
    subscriber.sm.subscribe(async () => { /* irrelevant for 'always' posture */ });

    const result = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'],
      payload:        { taskId: 'T1', text: 'Repaint hallway' },
      timeoutMs:      300,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].actor).toBe(FRITS);

    await tearDown([broadcaster, subscriber]);
  });

  it('skips agents whose skills do not intersect requiredSkills', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const skipper     = await makeOfferingMatch({
      bus, label: 'F', group: 'g', actor: FRITS,
      offerings: ['plumb'], posture: { plumb: 'always' },
    });
    wirePeers([broadcaster, skipper]);
    await broadcaster.sm.start();
    await skipper.sm.start();
    const handler = vi.fn();
    skipper.sm.subscribe(handler);

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 100,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(r.claims).toHaveLength(0);

    await tearDown([broadcaster, skipper]);
  });

  it('respects posture: never (no claim, no handler)', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const refuser     = await makeOfferingMatch({
      bus, label: 'F', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'never' },
    });
    wirePeers([broadcaster, refuser]);
    await broadcaster.sm.start();
    await refuser.sm.start();
    const handler = vi.fn();
    refuser.sm.subscribe(handler);

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 100,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(r.claims).toHaveLength(0);

    await tearDown([broadcaster, refuser]);
  });

  it('posture: negotiable runs the handler; handler.decide("claim") sends back', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const human       = await makeOfferingMatch({
      bus, label: 'F', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'negotiable' },
    });
    wirePeers([broadcaster, human]);
    await broadcaster.sm.start();
    await human.sm.start();
    human.sm.subscribe(async ({ decide }) => { await decide('claim'); });

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: { x: 1 }, timeoutMs: 300,
    });
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].actor).toBe(FRITS);

    await tearDown([broadcaster, human]);
  });

  it('posture: negotiable + decide("decline") yields no claim', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const human       = await makeOfferingMatch({
      bus, label: 'F', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'negotiable' },
    });
    wirePeers([broadcaster, human]);
    await broadcaster.sm.start();
    await human.sm.start();
    human.sm.subscribe(async ({ decide }) => decide('decline'));

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 100,
    });
    expect(r.claims).toHaveLength(0);

    await tearDown([broadcaster, human]);
  });

  it('multiple subscribers; expectClaims=2 collects both', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const a = await makeOfferingMatch({
      bus, label: 'F', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    const b = await makeOfferingMatch({
      bus, label: 'K', group: 'g', actor: KID,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    wirePeers([broadcaster, a, b]);
    await broadcaster.sm.start();
    await a.sm.start();
    await b.sm.start();
    a.sm.subscribe(async () => {});
    b.sm.subscribe(async () => {});

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 300, expectClaims: 2,
    });
    expect(r.claims).toHaveLength(2);
    expect(r.claims.map((c) => c.actor).sort()).toEqual([FRITS, KID].sort());

    await tearDown([broadcaster, a, b]);
  });
});

describe('OfferingMatch — group isolation', () => {
  it('agents in different groups do not see each other (subscriptions filtered by topic)', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({
      bus, label: 'A', group: 'household-A', actor: ANNE,
    });
    const outsider = await makeOfferingMatch({
      bus, label: 'F', group: 'household-B', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    // Roster wires them as peers, but the topic prefix differs by group —
    // pubsub topics are scoped per-group, so the outsider's subscription
    // is on `household-B/requests` not `household-A/requests`.
    wirePeers([broadcaster, outsider]);
    await broadcaster.sm.start();
    await outsider.sm.start();
    const handler = vi.fn();
    outsider.sm.subscribe(handler);

    const r = await broadcaster.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 100,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(r.claims).toHaveLength(0);

    await tearDown([broadcaster, outsider]);
  });
});

describe('OfferingMatch — constructor + roster', () => {
  it('throws without an agent', () => {
    expect(() => new OfferingMatch({ group: 'g' })).toThrow(/agent.*required/i);
  });

  it('throws without a group', async () => {
    const bus   = new InternalBus();
    const agent = await makeCoreAgent(bus, 'X');
    expect(() => new OfferingMatch({ agent })).toThrow(/group required/);
    await agent.stop();
  });

  it('addPeer before start() registers when start() runs', async () => {
    const bus = new InternalBus();
    const a = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const b = await makeOfferingMatch({
      bus, label: 'B', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    a.agent.addPeer(b.agent.address, b.agent.pubKey);
    b.agent.addPeer(a.agent.address, a.agent.pubKey);
    a.sm.addPeer({ pubKey: b.agent.address });
    b.sm.addPeer({ pubKey: a.agent.address });
    await a.sm.start();
    await b.sm.start();
    b.sm.subscribe(async () => {});
    const r = await a.sm.broadcast({
      requiredOfferings: ['paint'], payload: {}, timeoutMs: 300,
    });
    expect(r.claims).toHaveLength(1);
    await tearDown([a, b]);
  });
});

describe('OfferingMatch — Phase 40.20 broadcast scope + extraAudience', () => {
  it('extraAudience peer receives a `group+contacts` broadcast with fromExtraAudience=true', async () => {
    const bus = new InternalBus();
    // Broadcaster is in group g. Receiver is also in group g — but
    // we register them as extraAudience-of-each-other to mimic
    // "contact outside the group" behaviour without leaving the
    // single-group test fixture.
    const a = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const b = await makeOfferingMatch({
      bus, label: 'B', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    a.agent.addPeer(b.agent.address, b.agent.pubKey);
    b.agent.addPeer(a.agent.address, a.agent.pubKey);
    a.sm.addExtraAudiencePeer({ pubKey: b.agent.address });
    b.sm.addExtraAudiencePeer({ pubKey: a.agent.address });
    await a.sm.start();
    await b.sm.start();

    let receivedRequest = null;
    b.sm.subscribe(async ({ request, decide }) => {
      receivedRequest = request;
      // Extra-audience never auto-claims (Phase 40.20 §8a Q3 lock):
      // the receiver MUST opt in explicitly. Simulate the "user
      // tapped Help" path here.
      await decide('claim');
    });

    const r = await a.sm.broadcast({
      requiredOfferings: ['paint'],
      payload:        { text: 'help' },
      scope:          'group+contacts',
      timeoutMs:      300,
    });

    expect(receivedRequest).not.toBeNull();
    expect(receivedRequest.fromExtraAudience).toBe(true);
    expect(receivedRequest.scope).toBe('group+contacts');
    expect(r.claims).toHaveLength(1);
    await tearDown([a, b]);
  });

  it('extra-audience peers do NOT auto-claim even when posture is always', async () => {
    const bus = new InternalBus();
    const a = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const b = await makeOfferingMatch({
      bus, label: 'B', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    a.agent.addPeer(b.agent.address, b.agent.pubKey);
    b.agent.addPeer(a.agent.address, a.agent.pubKey);
    a.sm.addExtraAudiencePeer({ pubKey: b.agent.address });
    b.sm.addExtraAudiencePeer({ pubKey: a.agent.address });
    await a.sm.start();
    await b.sm.start();

    // No subscriber — the substrate's auto-claim path would normally
    // fire on posture='always'. With fromExtraAudience=true it must
    // skip auto-claim and wait for an explicit handler.
    const r = await a.sm.broadcast({
      requiredOfferings: ['paint'], payload: {},
      scope: 'group+contacts',
      timeoutMs: 200,
    });
    expect(r.claims).toHaveLength(0);
    await tearDown([a, b]);
  });

  it('rejects an unknown scope', async () => {
    const bus = new InternalBus();
    const a = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    await a.sm.start();
    await expect(
      a.sm.broadcast({ requiredOfferings: ['x'], payload: {}, scope: 'world' }),
    ).rejects.toThrow(/scope must be one of/);
    await tearDown([a]);
  });

  it('group-scope broadcast keeps today\'s auto-claim behaviour intact', async () => {
    const bus = new InternalBus();
    const a = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    const b = await makeOfferingMatch({
      bus, label: 'B', group: 'g', actor: FRITS,
      offerings: ['paint'], posture: { paint: 'always' },
    });
    wirePeers([a, b]);
    await a.sm.start();
    await b.sm.start();
    // No b.sm.subscribe — relies on the auto-claim path.
    const r = await a.sm.broadcast({
      requiredOfferings: ['paint'], payload: {},
      timeoutMs: 300,
      // scope omitted → defaults to 'group'
    });
    expect(r.claims).toHaveLength(1);
    await tearDown([a, b]);
  });
});

describe('OfferingMatch — legacy wire read-accept', () => {
  it('accepts the legacy `skills` constructor arg + `requiredSkills` broadcast field', async () => {
    const bus = new InternalBus();
    const broadcaster = await makeOfferingMatch({ bus, label: 'A', group: 'g', actor: ANNE });
    // Construct the subscriber directly with the LEGACY `skills` arg.
    const agent = await makeCoreAgent(bus, 'F');
    const sub = new OfferingMatch({
      agent, group: 'g', localActor: FRITS,
      skills: ['paint'], posture: { paint: 'always' },
    });
    const subscriber = { agent, sm: sub };
    wirePeers([broadcaster, subscriber]);
    await broadcaster.sm.start();
    await subscriber.sm.start();
    subscriber.sm.subscribe(async () => {});

    // Broadcast with the LEGACY `requiredSkills` field.
    const r = await broadcaster.sm.broadcast({
      requiredSkills: ['paint'], payload: {}, timeoutMs: 300,
    });
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].actor).toBe(FRITS);
    await tearDown([broadcaster, subscriber]);
  });
});
