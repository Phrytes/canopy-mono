/**
 * V1.5 — cap-token-bound bot agent (the V1.5 plan item).
 *
 * Asserts the real PolicyEngine path:
 *   - issueBotToken spawns a bot agent and stores a CapabilityToken in
 *     its TokenRegistry.
 *   - When wireBotChannel sees a cap-token binding, it dispatches via
 *     `botAgent.invoke(tasksAgent.address, ...)` so taskExchange runs
 *     PolicyEngine.checkInbound (verifies signature, expiry, subject,
 *     issuer trust). Token is auto-attached.
 *   - bot.* handlers honour `actingAs` from `envelope.payload._token`,
 *     so `from` = bound webid even though `envelope._from` = bot pubKey.
 *   - revokeBotToken returns the binding to legacy trust-map mode.
 *   - Legacy chatBindings still work alongside cap-token bindings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InMemoryBridge } from '@canopy/chat-agent';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';
import { wireBotChannel } from '../src/bot/wireBotChannel.js';

const ANNE  = 'https://id.example/anne';
const KID   = 'https://id.example/kid';

const ANNE_CHAT = '111';
const KID_CHAT  = '222';

const CREW = {
  crewId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: KID,  displayName: 'Kid',  role: 'member' },
  ],
};

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

describe('V1.5 — cap-token-bound bot agent', () => {
  let crew;

  beforeEach(async () => {
    const bundle = buildBundle();
    crew = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    try { await crew.close(); } catch { /* noop */ }
  });

  it('exposes a BotAgentRegistry on the bundle', async () => {
    expect(crew.botAgentRegistry).toBeTruthy();
    expect(typeof crew.botAgentRegistry.issue).toBe('function');
    expect(typeof crew.botAgentRegistry.revoke).toBe('function');
  });

  it('issueBotToken spawns a bot agent + holds a token; getBotChatBindings reflects mode', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    const r = await call(crew, 'issueBotToken', { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    expect(r.ok).toBe(true);
    expect(r.tokenId).toBeTruthy();
    expect(r.botPubKey).toBeTruthy();
    expect(r.expiresAt).toBeGreaterThan(Date.now());

    const bindings = await call(crew, 'getBotChatBindings', {}, ANNE);
    expect(bindings.items).toMatchObject([{
      chatId: ANNE_CHAT,
      webid:  ANNE,
      mode:   'cap-token',
    }]);

    // Bot agent is in the registry.
    const entry = crew.botAgentRegistry.get(ANNE_CHAT);
    expect(entry).toBeTruthy();
    expect(entry.binding.tokenId).toBe(r.tokenId);
    expect(entry.binding.webid).toBe(ANNE);
  });

  it('issueBotToken refuses unbound chatIds', async () => {
    const r = await call(crew, 'issueBotToken', { chatId: 'unbound', ttlDays: 1 }, ANNE);
    expect(r.error).toMatch(/not bound/);
  });

  it('member is denied on issue / revoke', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    expect((await call(crew, 'issueBotToken',  { chatId: ANNE_CHAT },              KID)).error).toMatch(/admin/);
    expect((await call(crew, 'revokeBotToken', { chatId: ANNE_CHAT },              KID)).error).toMatch(/admin/);
  });

  it('end-to-end cap-token dispatch: chat → invoke → PolicyEngine → handler runs as actingAs', async () => {
    // Anne adds a task (UI path).
    const addRes = await call(crew, 'addTask', { text: 'Cap-token test task' }, ANNE);
    const taskId = addRes.task.id;

    // Bind chat 111 → Anne, then issue cap-token.
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);

    // Wire a bridge that goes through wireBotChannel with the registry.
    const bridge = new InMemoryBridge({ id: 'capt-bot' });
    const channel = await wireBotChannel({
      agent:            crew.agent,
      bridges:          [{ bridge, name: 'test' }],
      chatBindings:     () => crew.getCrew()?.bot?.chatBindings ?? {},
      botAgentRegistry: crew.botAgentRegistry,
    });

    bridge.outbox.length = 0;
    await bridge.simulateIncoming({ chatId: ANNE_CHAT, text: 'open' });
    await new Promise((r) => setTimeout(r, 30));
    const reply = bridge.outbox.map((o) => o.text).join('\n---\n');
    expect(reply).toMatch(/Cap-token test task/);
    expect(reply).toContain(taskId.slice(0, 8));

    // Audit log: the addTask we did directly + nothing from the bot
    // (read-only listOpen). So just confirm the log exists and the
    // action attribution makes sense for direct UI calls.
    const log = await crew.itemStore.auditLog({ itemId: taskId });
    expect(log.find((e) => e.action === 'add')?.actor).toBe(ANNE);

    await channel.detach();
  });

  it('cap-token claim records (via bot) in the audit log for the actingAs webid', async () => {
    const addRes = await call(crew, 'addTask', { text: 'Claim through cap-token bot' }, ANNE);
    const id = addRes.task.id;

    await call(crew, 'setBotChatBinding', { chatId: KID_CHAT, webid: KID }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: KID_CHAT, ttlDays: 1 }, ANNE);

    const bridge = new InMemoryBridge({ id: 'capt-bot-claim' });
    const channel = await wireBotChannel({
      agent:            crew.agent,
      bridges:          [{ bridge, name: 'test' }],
      chatBindings:     () => crew.getCrew()?.bot?.chatBindings ?? {},
      botAgentRegistry: crew.botAgentRegistry,
    });

    await bridge.simulateIncoming({ chatId: KID_CHAT, text: `claim ${id.slice(0, 8)}` });
    await new Promise((r) => setTimeout(r, 30));

    const log = await crew.itemStore.auditLog({ itemId: id });
    const claim = log.find((e) => e.action === 'claim');
    expect(claim).toBeTruthy();
    // V1.5 cap-token: actor = the bound webid (KID), not the bot's pubKey.
    expect(claim.actor).toBe(KID);
    expect(claim.actorDisplayName).toMatch(/via bot/i);

    await channel.detach();
  });

  it('revokeBotToken returns the binding to trust-map mode', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    expect(crew.botAgentRegistry.get(ANNE_CHAT)).toBeTruthy();

    const r = await call(crew, 'revokeBotToken', { chatId: ANNE_CHAT }, ANNE);
    expect(r).toEqual({ ok: true, chatId: ANNE_CHAT });
    expect(crew.botAgentRegistry.get(ANNE_CHAT)).toBeNull();

    const after = await call(crew, 'getBotChatBindings', {}, ANNE);
    expect(after.items).toMatchObject([{ chatId: ANNE_CHAT, webid: ANNE, mode: 'trust' }]);
  });

  it('removeBotChatBinding also tears down any cap-token bot agent', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    await call(crew, 'removeBotChatBinding', { chatId: ANNE_CHAT }, ANNE);
    expect(crew.botAgentRegistry.get(ANNE_CHAT)).toBeNull();
  });

  it('cap-token is scoped to bot.* — TokenRegistry.get matches bot skills only', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    const entry = crew.botAgentRegistry.get(ANNE_CHAT);
    expect(entry).toBeTruthy();

    // The bot's TokenRegistry lookup for any bot.* skill returns the
    // token; for skills outside the namespace, it returns null —
    // proving the V1.5 follow-up A scope is honoured at the holder
    // side. PolicyEngine line 165 also enforces the same on the
    // verifier side; covered in packages/core/test/Permissions.test.js.
    const tasksId = crew.agent.pubKey;
    const t1 = await entry.tokenRegistry.get(tasksId, 'bot.listOpen');
    expect(t1?.id).toBe(entry.binding.tokenId);
    const t2 = await entry.tokenRegistry.get(tasksId, 'bot.claim');
    expect(t2?.id).toBe(entry.binding.tokenId);

    const t3 = await entry.tokenRegistry.get(tasksId, 'addTask');
    expect(t3).toBeNull();
    const t4 = await entry.tokenRegistry.get(tasksId, 'removeTask');
    expect(t4).toBeNull();
  });

  it('revoked token is rejected by PolicyEngine even when held in the bot vault (server-side revocation)', async () => {
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    const entry = crew.botAgentRegistry.get(ANNE_CHAT);
    expect(entry).toBeTruthy();

    // Sanity: bot.* invoke works pre-revoke.
    const okParts = await entry.agent.invoke(crew.agent.address, 'bot.listOpen', [
      { type: 'DataPart', data: {} },
    ], { timeout: 5000 });
    expect(okParts).toBeDefined();

    // Capture the token blob + bot agent BEFORE revoke (revoke
    // tears down the bot, so we'd lose the handle otherwise).
    const tokenBlob = await entry.tokenRegistry.get(crew.agent.address, 'bot.listOpen');
    expect(tokenBlob).toBeTruthy();
    const botAgent = entry.agent;

    // Mark token revoked on the issuer side WITHOUT killing the bot
    // vault — simulate the "stolen token still present in attacker's
    // wallet" scenario.
    crew.botAgentRegistry.isRevoked; // method exists
    // eslint-disable-next-line no-underscore-dangle
    // Use the public API but skip the agent.stop() side-effect by
    // calling revoke and then NOT counting on the bot agent.
    await crew.botAgentRegistry.revoke({ chatId: ANNE_CHAT });
    expect(crew.botAgentRegistry.isRevoked(tokenBlob.id)).toBe(true);

    // Re-create a fresh bot agent that holds the same token blob
    // (the "attacker still has the stolen token") and invoke.
    // PolicyEngine should reject because the token is revoked.
    // To simulate this cleanly, we re-import the token into a brand
    // new vault + agent on the same bus.
    const { AgentIdentity, VaultMemory, InternalTransport, TrustRegistry, TokenRegistry, Agent, CapabilityToken } =
      await import('@canopy/core');
    const v   = new VaultMemory();
    const id  = await AgentIdentity.generate(v);
    const tx  = new InternalTransport(crew.agent.transport.bus, id.pubKey, { identity: id });
    const tr  = new TrustRegistry(v);
    // Token's subject is the OLD bot's pubKey, not the new id, so
    // PolicyEngine's "subject must equal peerPubKey" check rejects
    // *before* the revocation check. So we instead test directly
    // against PolicyEngine.checkInbound to isolate the revocation
    // path.
    void Agent; void tx; void tr;

    const denied = await crew.agent.policyEngine.checkInbound({
      peerPubKey: botAgent.pubKey,
      skillId:    'bot.listOpen',
      action:     'call',
      token:      tokenBlob.toJSON(),
      agentPubKey: crew.agent.pubKey,
    }).catch((e) => e);
    expect(denied?.name).toBe('PolicyDeniedError');
    expect(denied?.code).toBe('INVALID_TOKEN');
    expect(denied?.message).toMatch(/revoked/i);

    // Sanity: a non-revoked token still passes the same path.
    // Issue a fresh binding/token and check.
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    await call(crew, 'issueBotToken',     { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    const entry2 = crew.botAgentRegistry.get(ANNE_CHAT);
    const tok2   = await entry2.tokenRegistry.get(crew.agent.address, 'bot.listOpen');
    const ok = await crew.agent.policyEngine.checkInbound({
      peerPubKey: entry2.agent.pubKey,
      skillId:    'bot.listOpen',
      action:     'call',
      token:      tok2.toJSON(),
      agentPubKey: crew.agent.pubKey,
    });
    expect(ok.allowed).toBe(true);
  });

  it('persists bot identity + token; restoreAll re-spawns the bot after a fresh boot', async () => {
    // Shared Map represents a disk-backed local cache; the second
    // bundle reads the same one a real CLI restart would.
    const sharedStore = new Map();

    // ── Boot 1: issue a cap-token binding.
    const bundle1 = buildBundle({ localStore: sharedStore });
    const crew1   = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle1,
      wireOnboardingSkills: false,
    });
    expect(crew1.botAgentRegistry?.persisting).toBe(true);
    await call(crew1, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    const issued = await call(crew1, 'issueBotToken',
      { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    expect(issued.ok).toBe(true);
    const originalTokenId   = issued.tokenId;
    const originalBotPubKey = issued.botPubKey;

    // The persisted blob lives at our convention path.
    const persistedKey = [...sharedStore.keys()].find((k) => k.includes('/botAgents/'));
    expect(persistedKey).toBeTruthy();

    // close crew1 — bot agent stops; persistent blob stays.
    await crew1.close();

    // ── Boot 2: same store. Crew should restore.
    const bundle2 = buildBundle({ localStore: sharedStore });
    const crew2   = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle2,
      wireOnboardingSkills: false,
    });
    // Force a re-bind of the chatId in the crew config (it doesn't
    // persist across crew constructions in this test setup; the
    // BotAgentRegistry restore is what actually matters).
    await call(crew2, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);

    const restoredEntry = crew2.botAgentRegistry.get(ANNE_CHAT);
    expect(restoredEntry).toBeTruthy();
    // V2.0 — both bot identity AND token are stable across restarts.
    // Bot vault is snapshot-restored (since V1.5 follow-up B); tasks
    // agent identity is now also snapshot-restored (V2.0), so the
    // token's `agentId` still matches and no rotation is needed.
    expect(restoredEntry.binding.botPubKey).toBe(originalBotPubKey);
    expect(restoredEntry.binding.tokenId).toBe(originalTokenId);

    // It actually works — bot can still invoke bot.* skills.
    await call(crew2, 'addTask', { text: 'restored-bot test' }, ANNE);
    const bridge = new InMemoryBridge({ id: 'restored-bot' });
    const channel = await wireBotChannel({
      agent:            crew2.agent,
      bridges:          [{ bridge, name: 'test' }],
      chatBindings:     () => crew2.getCrew()?.bot?.chatBindings ?? {},
      botAgentRegistry: crew2.botAgentRegistry,
    });
    bridge.outbox.length = 0;
    await bridge.simulateIncoming({ chatId: ANNE_CHAT, text: 'open' });
    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.outbox.map((o) => o.text).join('\n')).toMatch(/restored-bot test/);

    await channel.detach();
    await crew2.close();
  });

  it('restoreAll skips expired tokens + drops their persistent rows', async () => {
    const sharedStore = new Map();
    const bundle1 = buildBundle({ localStore: sharedStore });
    const crew1   = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle1,
      wireOnboardingSkills: false,
    });
    await call(crew1, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);

    // Manually craft a persisted-but-expired entry to bypass the
    // "ttlDays > 0" guard.
    const path = `mem://tasks/crews/${CREW.crewId}/botAgents/${encodeURIComponent(ANNE_CHAT)}.json`;
    sharedStore.set(path, JSON.stringify({
      binding: { chatId: ANNE_CHAT, webid: ANNE, botPubKey: 'fake', tokenId: 'fake', issuedAt: 1, expiresAt: 1 },
      vault:   { foo: 'bar' },     // doesn't matter — never read
      token:   { id: 'fake' },
    }));
    await crew1.close();

    const bundle2 = buildBundle({ localStore: sharedStore });
    const crew2   = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     bundle2,
      wireOnboardingSkills: false,
    });
    expect(crew2.botAgentRegistry.get(ANNE_CHAT)).toBeNull();
    expect(sharedStore.has(path)).toBe(false);
    await crew2.close();
  });

  it('legacy trust-map binding (no token) still dispatches via direct path', async () => {
    await call(crew, 'addTask', { text: 'Legacy trust test' }, ANNE);
    await call(crew, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    // No issueBotToken — legacy path.

    const bridge = new InMemoryBridge({ id: 'legacy-bot' });
    const channel = await wireBotChannel({
      agent:            crew.agent,
      bridges:          [{ bridge, name: 'test' }],
      chatBindings:     () => crew.getCrew()?.bot?.chatBindings ?? {},
      botAgentRegistry: crew.botAgentRegistry,
    });

    bridge.outbox.length = 0;
    await bridge.simulateIncoming({ chatId: ANNE_CHAT, text: 'open' });
    await new Promise((r) => setTimeout(r, 30));
    const reply = bridge.outbox.map((o) => o.text).join('\n---\n');
    expect(reply).toMatch(/Legacy trust test/);

    await channel.detach();
  });
});
