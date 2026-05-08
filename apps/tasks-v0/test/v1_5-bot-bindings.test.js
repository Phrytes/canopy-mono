/**
 * V1.5 — bot binding management skills.
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

import { InMemoryBridge } from '@canopy/chat-agent';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';
import { wireBotChannel } from '../src/bot/wireBotChannel.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  crewId:  'oss-tools',
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
  const crew = await createCrewAgent({
    crewConfig:           CREW,
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, crew };
}

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

describe('V1.5 — bot bindings', () => {
  let crew;

  beforeEach(async () => {
    ({ crew } = await setup());
  });

  it('member is denied on read + write', async () => {
    expect((await call(crew, 'getBotChatBindings', {}, KID)).error).toMatch(/admin or coordinator/);
    expect((await call(crew, 'setBotChatBinding', { chatId: '1', webid: KID }, KID)).error).toMatch(/admin/);
    expect((await call(crew, 'removeBotChatBinding', { chatId: '1' }, KID)).error).toMatch(/admin/);
  });

  it('coordinator can read but not write', async () => {
    const r = await call(crew, 'getBotChatBindings', {}, FRITS);
    expect(r.items).toEqual([]);
    expect((await call(crew, 'setBotChatBinding', { chatId: '1', webid: ANNE }, FRITS)).error).toMatch(/admin/);
  });

  it('setBotChatBinding adds + lists; rejects unknown webid', async () => {
    expect((await call(crew, 'setBotChatBinding',
      { chatId: '111', webid: 'https://nope.example/x' }, ANNE)).error).toMatch(/not a crew member/);

    const r1 = await call(crew, 'setBotChatBinding', { chatId: '111', webid: ANNE }, ANNE);
    expect(r1).toEqual({ ok: true, chatId: '111', webid: ANNE });

    const r2 = await call(crew, 'getBotChatBindings', {}, ANNE);
    expect(r2.items).toMatchObject([{ chatId: '111', webid: ANNE, mode: 'trust' }]);
  });

  it('setBotChatBinding overwrites existing chatId', async () => {
    await call(crew, 'setBotChatBinding', { chatId: '111', webid: ANNE  }, ANNE);
    await call(crew, 'setBotChatBinding', { chatId: '111', webid: FRITS }, ANNE);
    const r = await call(crew, 'getBotChatBindings', {}, ANNE);
    expect(r.items).toMatchObject([{ chatId: '111', webid: FRITS, mode: 'trust' }]);
  });

  it('removeBotChatBinding removes; errors on unknown', async () => {
    await call(crew, 'setBotChatBinding', { chatId: '111', webid: ANNE }, ANNE);
    const rm = await call(crew, 'removeBotChatBinding', { chatId: '111' }, ANNE);
    expect(rm).toEqual({ ok: true, chatId: '111' });

    const after = await call(crew, 'getBotChatBindings', {}, ANNE);
    expect(after.items).toEqual([]);

    const missing = await call(crew, 'removeBotChatBinding', { chatId: 'nope' }, ANNE);
    expect(missing.error).toMatch(/not bound/);
  });

  it('rejects empty inputs', async () => {
    expect((await call(crew, 'setBotChatBinding', { chatId: '',  webid: ANNE }, ANNE)).error).toMatch(/chatId/);
    expect((await call(crew, 'setBotChatBinding', { chatId: '1', webid: ''   }, ANNE)).error).toMatch(/webid/);
    expect((await call(crew, 'removeBotChatBinding', {}, ANNE)).error).toMatch(/chatId/);
  });

  it('a freshly-set binding is honoured by wireBotChannel end-to-end', async () => {
    const bridge = new InMemoryBridge({ id: 'test-bot' });
    // Crew.bot.chatBindings is initially empty — ANNE_CHAT '999' is unbound.
    const r = await wireBotChannel({
      agent:        crew.agent,
      bridges:      [{ bridge, name: 'test' }],
      // Bridge reads the live config via getCrew(); pass an empty
      // map here and rely on the skills to populate the live one.
      chatBindings: () => crew.getCrew()?.bot?.chatBindings ?? {},
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
    await call(crew, 'setBotChatBinding', { chatId: '999', webid: ANNE }, ANNE);

    // Now '999' acts as Anne; "open" returns the empty-state line
    // instead of the unbound-chat hint.
    const after = await ask('999', 'open');
    expect(after).not.toMatch(/not bound/i);
    expect(after).toMatch(/no open tasks/i);

    await r.detach();
  });
});
