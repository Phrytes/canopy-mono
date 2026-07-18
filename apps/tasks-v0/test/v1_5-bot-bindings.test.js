/**
 * bot binding management skills.
 *
 * Asserts:
 *   - Member is denied (admin/coord-only read; admin-only writes).
 *   - getBotChatBindings returns the seeded bindings as a stable array.
 *   - setBotChatBinding adds + overwrites; rejects unknown webid.
 *   - removeBotChatBinding removes existing; errors on unknown chatId.
 *   - Mutations survive across read/write cycles (frozen-copy pattern).
 *   - Bindings flow through to the bot dispatcher (end-to-end smoke).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryBridge } from '@onderling/chat-agent';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { wireBotChannel } from '../src/bot/wireBotChannel.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function setup() {
  const bundle = buildBundle();
  const circle = await createCircleAgent({
    circleConfig:           CIRCLE,
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, circle };
}

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

describe('V1.5 — bot bindings', () => {
  let circle;

  beforeEach(async () => {
    ({ circle } = await setup());
  });

  it('member is denied on read + write', async () => {
    expect((await call(circle, 'getBotChatBindings', {}, KID)).error).toMatch(/admin or coordinator/);
    expect((await call(circle, 'setBotChatBinding', { chatId: '1', webid: KID }, KID)).error).toMatch(/admin/);
    expect((await call(circle, 'removeBotChatBinding', { chatId: '1' }, KID)).error).toMatch(/admin/);
  });

  it('coordinator can read but not write', async () => {
    const r = await call(circle, 'getBotChatBindings', {}, FRITS);
    expect(r.items).toEqual([]);
    expect((await call(circle, 'setBotChatBinding', { chatId: '1', webid: ANNE }, FRITS)).error).toMatch(/admin/);
  });

  it('setBotChatBinding adds + lists; rejects unknown webid', async () => {
    expect((await call(circle, 'setBotChatBinding',
      { chatId: '111', webid: 'https://nope.example/x' }, ANNE)).error).toMatch(/not a circle member/);

    const r1 = await call(circle, 'setBotChatBinding', { chatId: '111', webid: ANNE }, ANNE);
    expect(r1).toEqual({ ok: true, chatId: '111', webid: ANNE });

    const r2 = await call(circle, 'getBotChatBindings', {}, ANNE);
    expect(r2.items).toMatchObject([{ chatId: '111', webid: ANNE, mode: 'trust' }]);
  });

  it('setBotChatBinding overwrites existing chatId', async () => {
    await call(circle, 'setBotChatBinding', { chatId: '111', webid: ANNE  }, ANNE);
    await call(circle, 'setBotChatBinding', { chatId: '111', webid: FRITS }, ANNE);
    const r = await call(circle, 'getBotChatBindings', {}, ANNE);
    expect(r.items).toMatchObject([{ chatId: '111', webid: FRITS, mode: 'trust' }]);
  });

  it('removeBotChatBinding removes; errors on unknown', async () => {
    await call(circle, 'setBotChatBinding', { chatId: '111', webid: ANNE }, ANNE);
    const rm = await call(circle, 'removeBotChatBinding', { chatId: '111' }, ANNE);
    expect(rm).toEqual({ ok: true, chatId: '111' });

    const after = await call(circle, 'getBotChatBindings', {}, ANNE);
    expect(after.items).toEqual([]);

    const missing = await call(circle, 'removeBotChatBinding', { chatId: 'nope' }, ANNE);
    expect(missing.error).toMatch(/not bound/);
  });

  it('rejects empty inputs', async () => {
    expect((await call(circle, 'setBotChatBinding', { chatId: '',  webid: ANNE }, ANNE)).error).toMatch(/chatId/);
    expect((await call(circle, 'setBotChatBinding', { chatId: '1', webid: ''   }, ANNE)).error).toMatch(/webid/);
    expect((await call(circle, 'removeBotChatBinding', {}, ANNE)).error).toMatch(/chatId/);
  });

  it('a freshly-set binding is honoured by wireBotChannel end-to-end', async () => {
    const bridge = new InMemoryBridge({ id: 'test-bot' });
    // Circle.bot.chatBindings is initially empty — ANNE_CHAT '999' is unbound.
    const r = await wireBotChannel({
      agent:        circle.agent,
      bridges:      [{ bridge, name: 'test' }],
      // Bridge reads the live config via getCircle(); pass an empty
      // map here and rely on the skills to populate the live one.
      chatBindings: () => circle.getCircle()?.bot?.chatBindings ?? {},
    });

    async function ask(chatId, text) {
      bridge.outbox.length = 0;
      await bridge.simulateIncoming({ chatId, text });
      await new Promise((res) => setTimeout(res, 5));
      return bridge.outbox.map((o) => o.text).join('\n---\n');
    }

    // Initially unbound: the friendly hint reply mentions the chatId.
    const before = await ask('999', 'open');
    expect(before).toMatch(/not bound/i);
    expect(before).toContain('999');

    // Admin binds it.
    await call(circle, 'setBotChatBinding', { chatId: '999', webid: ANNE }, ANNE);

    // Now '999' acts as Anne; "open" returns the empty-state line
    // instead of the unbound-chat hint.
    const after = await ask('999', 'open');
    expect(after).not.toMatch(/not bound/i);
    expect(after).toMatch(/no open tasks/i);

    await r.detach();
  });
});
