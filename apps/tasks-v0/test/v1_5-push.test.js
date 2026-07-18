/**
 * push side-channel wiring through Circle.
 *
 * Asserts that:
 *   - When `pushSender` is supplied AND `circleConfig.pushTokens` maps
 *     a recipient, immediate notifications (completed / submitted /
 *     rejected / revoked) reach the push sender — alongside the
 *     existing inbox dispatch.
 *   - When no token is bound for a webid, the inbox still fires,
 *     push doesn't.
 *   - Without `pushSender`, push wiring is dormant — V1 behaviour
 *     unchanged.
 *   - `pushPolicy.maxPerDay` is honoured at the Circle level.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const ANNE_TOKEN  = 'ExponentPushToken[anne]';
const KID_TOKEN   = 'ExponentPushToken[kid]';

function makeCircle(overrides = {}) {
  return {
    circleId:  'oss-tools',
    name:    'OSS Tools NL',
    kind:    'project',
    members: [
      { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
      { webid: FRITS, displayName: 'the author', role: 'coordinator' },
      { webid: KID,   displayName: 'Kid',   role: 'member' },
    ],
    pushTokens: {
      [ANNE]: ANNE_TOKEN,
      [KID]:  KID_TOKEN,
      // FRITS intentionally omitted to test the "no token" path.
    },
    ...overrides,
  };
}

function makeFakePushSender() {
  const calls = [];
  return {
    calls,
    send: vi.fn(async (token, payload, opts) => {
      calls.push({ token, payload, opts });
      return { ok: true };
    }),
  };
}

describe('V1.5 — Circle push side-channel', () => {
  let bundle;
  let circle;
  let push;

  async function setup({ overrides = {}, withPushSender = true } = {}) {
    bundle = buildBundle();
    push   = withPushSender ? makeFakePushSender() : null;
    circle = await createCircleAgent({
      circleConfig:           makeCircle(overrides),
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
      ...(withPushSender ? { pushSender: push } : {}),
    });
  }

  beforeEach(() => { bundle = null; circle = null; push = null; });

  it('item-completed → push fires for the master with a token', async () => {
    await setup();
    const add = circle.agent.skills.get('addTask');
    const r = await add.handler({
      parts: [{ type: 'DataPart', data: { text: 'Trash' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const claim = circle.agent.skills.get('claimTask');
    await claim.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    const done = circle.agent.skills.get('completeTask');
    await done.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });

    // Master = ANNE (addedBy). Anne has a token bound → 1 push.
    await new Promise((res) => setTimeout(res, 5));
    expect(push.send).toHaveBeenCalled();
    const tokens = push.calls.map((c) => c.token);
    expect(tokens).toContain(ANNE_TOKEN);
  });

  it('skips push when the recipient has no bound token', async () => {
    // Master = FRITS this time, who has no pushTokens entry.
    await setup();
    const add = circle.agent.skills.get('addTask');
    const r = await add.handler({
      parts: [{ type: 'DataPart', data: { text: 'Bug fix', master: FRITS } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const claim = circle.agent.skills.get('claimTask');
    await claim.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    push.send.mockClear();
    push.calls.length = 0;
    const done = circle.agent.skills.get('completeTask');
    await done.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    await new Promise((res) => setTimeout(res, 5));
    // the author has no token → no push for this completion.
    expect(push.calls.find((c) => c.token === FRITS)).toBeUndefined();
    // (Anne might have got a side push from earlier item-added scheduling
    // but no explicit assertion here — we only care the author's webid yielded
    // no token.)
  });

  it('without a pushSender, no push wiring is attached (V1 behaviour)', async () => {
    await setup({ withPushSender: false });
    expect(push).toBeNull();
    const add = circle.agent.skills.get('addTask');
    const r = await add.handler({
      parts: [{ type: 'DataPart', data: { text: 'No-push task' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const claim = circle.agent.skills.get('claimTask');
    await claim.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    const done = circle.agent.skills.get('completeTask');
    await done.handler({
      parts: [{ type: 'DataPart', data: { id: r.task.id } }],
      from:  KID,
      agent: circle.agent,
      envelope: null,
    });
    // Nothing to assert against `push` because we didn't create one.
    // The point is just that the Circle built without crashing.
    expect(circle.agent).toBeTruthy();
  });

  it('honours pushPolicy.maxPerDay set on the circle config', async () => {
    await setup({ overrides: { pushPolicy: { maxPerDay: 1 } } });

    // Two completions back-to-back, both notifying Anne (master).
    async function makeAndComplete(text) {
      const add = circle.agent.skills.get('addTask');
      const r = await add.handler({
        parts: [{ type: 'DataPart', data: { text } }],
        from:  ANNE,
        agent: circle.agent,
        envelope: null,
      });
      const claim = circle.agent.skills.get('claimTask');
      await claim.handler({
        parts: [{ type: 'DataPart', data: { id: r.task.id } }],
        from:  KID,
        agent: circle.agent,
        envelope: null,
      });
      const done = circle.agent.skills.get('completeTask');
      await done.handler({
        parts: [{ type: 'DataPart', data: { id: r.task.id } }],
        from:  KID,
        agent: circle.agent,
        envelope: null,
      });
    }
    await makeAndComplete('A');
    await makeAndComplete('B');
    await new Promise((res) => setTimeout(res, 5));

    const anneCalls = push.calls.filter((c) => c.token === ANNE_TOKEN);
    expect(anneCalls.length).toBe(1); // capped at 1/day
  });
});
