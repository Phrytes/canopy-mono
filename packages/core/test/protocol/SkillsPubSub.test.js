import { describe, it, expect } from 'vitest';
import { Agent }                from '../../src/Agent.js';
import { AgentIdentity }        from '../../src/identity/AgentIdentity.js';
import { VaultMemory }          from '../../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';
import { defineSkill }          from '../../src/skills/defineSkill.js';
import { subscribe as pubsubSubscribe } from '../../src/protocol/pubSub.js';
import {
  SkillsPubSub,
  buildTopic,
  audienceFromHumanInTheLoop,
} from '../../src/protocol/SkillsPubSub.js';

// ── harness ───────────────────────────────────────────────────────────────────

async function makeAgent(skills = []) {
  const bus      = new InternalBus();
  const id       = await AgentIdentity.generate(new VaultMemory());
  const agent    = new Agent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey),
    skills,
  });
  await agent.start();
  return { bus, agent };
}

async function makeAgentOnBus(bus, skills = []) {
  const id    = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey),
    skills,
  });
  await agent.start();
  return agent;
}

async function makeConnectedPair(skillsA = [], skillsB = []) {
  const bus = new InternalBus();
  const a   = await makeAgentOnBus(bus, skillsA);
  const b   = await makeAgentOnBus(bus, skillsB);
  a.addPeer(b.address, b.pubKey);
  b.addPeer(a.address, a.pubKey);
  return { bus, a, b };
}

// Wire B as a pubSub subscriber to every skill topic that A could publish.
// Because pubSub.js is exact-match, we subscribe to the concrete topic A will
// emit; SkillsPubSub on B then pattern-matches on the inbound `'publish'`
// event regardless of which concrete topic the publisher used.
async function followSkill(b, a, skillId, opts = {}) {
  const sps = new SkillsPubSub({ agent: a });
  const topic = sps.topicFor(skillId, opts);
  await pubsubSubscribe(b, a.address, topic, () => {});
  // Yield so the subscribe OW lands on A.
  await new Promise(r => setTimeout(r, 10));
  return topic;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('audienceFromHumanInTheLoop', () => {
  it('maps the three values (and unknown) correctly', () => {
    expect(audienceFromHumanInTheLoop('never')).toBe('machine');
    expect(audienceFromHumanInTheLoop('required')).toBe('human');
    expect(audienceFromHumanInTheLoop('either')).toBe('either');
    // Unknown / undefined falls back to machine for back-compat.
    expect(audienceFromHumanInTheLoop(undefined)).toBe('machine');
    expect(audienceFromHumanInTheLoop('weird')).toBe('machine');
  });
});

describe('buildTopic', () => {
  it('produces the documented 5-segment format', () => {
    expect(buildTopic({
      group: 'my-block', posture: 'always', audience: 'human', skillId: 'summarize',
    })).toBe('skills:my-block:always:human:summarize');
  });

  it('defaults group to "none"', () => {
    expect(buildTopic({
      posture: 'negotiable', audience: 'machine', skillId: 'echo',
    })).toBe('skills:none:negotiable:machine:echo');
  });

  it('covers all 6 (posture × audience) cells', () => {
    const cells = [
      ['always',     'machine', 'skills:none:always:machine:s'],
      ['always',     'human',   'skills:none:always:human:s'],
      ['always',     'either',  'skills:none:always:either:s'],
      ['negotiable', 'machine', 'skills:none:negotiable:machine:s'],
      ['negotiable', 'human',   'skills:none:negotiable:human:s'],
      ['negotiable', 'either',  'skills:none:negotiable:either:s'],
    ];
    for (const [posture, audience, expected] of cells) {
      expect(buildTopic({ posture, audience, skillId: 's' })).toBe(expected);
    }
  });
});

describe('SkillsPubSub.topicFor', () => {
  it('derives the topic from the registered skill', async () => {
    const skill = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'negotiable',
    });
    const { agent } = await makeAgent([skill]);
    const sps = new SkillsPubSub({ agent });
    expect(sps.topicFor('summarize')).toBe('skills:none:negotiable:either:summarize');
    expect(sps.topicFor('summarize', { group: 'my-block' }))
      .toBe('skills:my-block:negotiable:either:summarize');
  });

  it('throws on unknown skill', async () => {
    const { agent } = await makeAgent();
    const sps = new SkillsPubSub({ agent });
    expect(() => sps.topicFor('nope')).toThrow(/not registered/);
  });
});

describe('SkillsPubSub broadcast + subscribe round-trip', () => {
  it('audience:human subscriber receives an "either"-broadcast skill', async () => {
    const skill = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'human' }, ev => received.push(ev));

    await followSkill(b, a, 'summarize');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('skills:none:always:either:summarize');
    expect(received[0].payload.skillId).toBe('summarize');
    expect(received[0].payload.posture).toBe('always');
    expect(received[0].payload.humanInTheLoop).toBe('either');
    expect(received[0].from).toBe(a.address);
  });

  it('audience:machine subscriber ALSO receives an "either"-broadcast skill', async () => {
    const skill = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'machine' }, ev => received.push(ev));

    await followSkill(b, a, 'summarize');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('skills:none:always:either:summarize');
  });

  it('audience:human subscriber does NOT receive a humanInTheLoop:never skill', async () => {
    const skill = defineSkill('crunchNumbers', async () => null, {
      humanInTheLoop: 'never',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'human' }, ev => received.push(ev));

    await followSkill(b, a, 'crunchNumbers');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('crunchNumbers');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it('audience:machine subscriber does NOT receive a humanInTheLoop:required skill', async () => {
    const skill = defineSkill('triageAlert', async () => null, {
      humanInTheLoop: 'required',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'machine' }, ev => received.push(ev));

    await followSkill(b, a, 'triageAlert');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('triageAlert');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it('group filtering: subscriber to a specific group only receives that group\'s broadcasts', async () => {
    const skill = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'any', group: 'my-block' }, ev => received.push(ev));

    // Subscribe to the wire topics for both groups — pubSub is exact-match.
    await followSkill(b, a, 'summarize', { group: 'none' });
    await followSkill(b, a, 'summarize', { group: 'my-block' });
    await followSkill(b, a, 'summarize', { group: 'other-block' });

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize'); // group 'none'
    await pubA.broadcastSkill('summarize', { group: 'my-block' });
    await pubA.broadcastSkill('summarize', { group: 'other-block' });
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('skills:my-block:always:either:summarize');
  });

  it('returned unsubscribe stops further deliveries', async () => {
    const skill = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([skill], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    const unsub = sub.subscribeToSkills({ audience: 'any' }, ev => received.push(ev));

    await followSkill(b, a, 'summarize');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize');
    await new Promise(r => setTimeout(r, 20));
    expect(received).toHaveLength(1);

    unsub();

    await pubA.broadcastSkill('summarize');
    await new Promise(r => setTimeout(r, 20));
    expect(received).toHaveLength(1); // no new delivery
  });

  it('audience:any with no other filters receives all broadcasts', async () => {
    const summary = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either',
      posture:        'always',
    });
    const number = defineSkill('crunchNumbers', async () => null, {
      humanInTheLoop: 'never',
      posture:        'negotiable',
    });
    const triage = defineSkill('triageAlert', async () => null, {
      humanInTheLoop: 'required',
      posture:        'always',
    });
    const { a, b } = await makeConnectedPair([summary, number, triage], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'any' }, ev => received.push(ev));

    await followSkill(b, a, 'summarize');
    await followSkill(b, a, 'crunchNumbers');
    await followSkill(b, a, 'triageAlert');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize');
    await pubA.broadcastSkill('crunchNumbers');
    await pubA.broadcastSkill('triageAlert');
    await new Promise(r => setTimeout(r, 30));

    expect(received).toHaveLength(3);
    const ids = received.map(r => r.payload.skillId).sort();
    expect(ids).toEqual(['crunchNumbers', 'summarize', 'triageAlert']);
  });

  it('either-only audience matches only the `either` segment', async () => {
    const summary = defineSkill('summarize', async () => null, {
      humanInTheLoop: 'either', posture: 'always',
    });
    const number = defineSkill('crunchNumbers', async () => null, {
      humanInTheLoop: 'never', posture: 'always',
    });
    const { a, b } = await makeConnectedPair([summary, number], []);

    const sub = new SkillsPubSub({ agent: b });
    const received = [];
    sub.subscribeToSkills({ audience: 'either-only' }, ev => received.push(ev));

    await followSkill(b, a, 'summarize');
    await followSkill(b, a, 'crunchNumbers');

    const pubA = new SkillsPubSub({ agent: a });
    await pubA.broadcastSkill('summarize');
    await pubA.broadcastSkill('crunchNumbers');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(1);
    expect(received[0].payload.skillId).toBe('summarize');
  });

  it('broadcastSkill throws on unknown skill', async () => {
    const { agent } = await makeAgent();
    const sps = new SkillsPubSub({ agent });
    await expect(sps.broadcastSkill('ghost')).rejects.toThrow(/not registered/);
  });
});
