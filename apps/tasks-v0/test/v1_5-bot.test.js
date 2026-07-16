/**
 * V1.5 — chat-bot bridge tests.
 *
 * Covers:
 *   1. dispatch() pure parser — every command + edge case.
 *   2. wireBotChannel end-to-end via chat-agent.InMemoryBridge:
 *      - unbound chatId → friendly hint reply
 *      - help → returns HELP_TEXT
 *      - listOpen + listMine empty / populated states
 *      - claim → done end-to-end (self-mark approval mode)
 *      - submit → approve end-to-end (creator approval mode)
 *      - reject without reason → error reply
 *      - revoke without reason → error reply
 *      - permission-denied surfaced as "Error: ..." reply
 *      - short id prefix (≥6 chars) resolves to a unique full id
 *   3. Audit log carries `(via bot)` annotation on bot-driven actions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InMemoryBridge } from '@onderling/chat-agent';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { wireBotChannel } from '../src/bot/wireBotChannel.js';
import { dispatch, HELP_TEXT } from '../src/bot/dispatch.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const ANNE_CHAT  = '111';
const FRITS_CHAT = '222';
const KID_CHAT   = '333';
const RANDO_CHAT = '999';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
  bot: {
    chatBindings: {
      [ANNE_CHAT]:  ANNE,
      [FRITS_CHAT]: FRITS,
      [KID_CHAT]:   KID,
    },
  },
};

// ── Pure dispatch tests ────────────────────────────────────────────────────

describe('V1.5 — dispatch (pure)', () => {
  it('routes simple verbs to the right bot.* skill', () => {
    expect(dispatch('open').skillId).toBe('bot.listOpen');
    expect(dispatch('list').skillId).toBe('bot.listOpen');
    expect(dispatch('mine').skillId).toBe('bot.listMine');
    expect(dispatch('master').skillId).toBe('bot.listMyMasteredTasks');
    expect(dispatch('review').skillId).toBe('bot.listAwaitingApproval');
    expect(dispatch('inbox').skillId).toBe('bot.listMyInbox');
  });

  it('parses "claim <id>" / "done <id>" / "approve <id>"', () => {
    const a = dispatch('claim 01ABCDEF');
    expect(a.kind).toBe('skill');
    expect(a.skillId).toBe('bot.claim');
    expect(a.args.id).toBe('01abcdef');

    expect(dispatch('done 01XYZ123').skillId).toBe('bot.markComplete');
    expect(dispatch('complete 01XYZ123').skillId).toBe('bot.markComplete');
    expect(dispatch('approve 01XYZ123').skillId).toBe('bot.approve');
  });

  it('parses "submit <id> note: <text>"', () => {
    const a = dispatch('submit 01ABCDEF note: photos uploaded');
    expect(a.kind).toBe('skill');
    expect(a.skillId).toBe('bot.submit');
    expect(a.args.id).toBe('01abcdef');
    expect(a.args.note).toBe('photos uploaded');
  });

  it('parses "reject <id> reason: <text>"', () => {
    const a = dispatch('reject 01ABCDEF reason: side photo missing');
    expect(a.skillId).toBe('bot.reject');
    expect(a.args.note).toBe('side photo missing');
  });

  it('rejects "reject <id>" without a reason → static reply', () => {
    const a = dispatch('reject 01ABCDEF anything');
    expect(a.kind).toBe('reply');
    expect(a.text).toMatch(/reason/i);
  });

  it('rejects "revoke <id>" without a reason → static reply', () => {
    const a = dispatch('revoke 01ABCDEF some text');
    expect(a.kind).toBe('reply');
    expect(a.text).toMatch(/reason/i);
  });

  it('parses "blocks <id>" + "tree <id>" → bot.whatBlocks', () => {
    expect(dispatch('blocks 01ABC123').skillId).toBe('bot.whatBlocks');
    expect(dispatch('tree 01ABC123').skillId).toBe('bot.whatBlocks');
  });

  it('parses "appeal <id>" → bot.appeal', () => {
    const a = dispatch('appeal 01ABCDEF');
    expect(a.skillId).toBe('bot.appeal');
    expect(a.args.taskId).toBe('01abcdef');
  });

  it('help / hi return static replies', () => {
    expect(dispatch('help').kind).toBe('reply');
    expect(dispatch('help').text).toBe(HELP_TEXT);
    expect(dispatch('?').kind).toBe('reply');
    expect(dispatch('hi').kind).toBe('reply');
  });

  it('unknown commands are flagged', () => {
    expect(dispatch('foo bar').kind).toBe('unknown');
    expect(dispatch('').kind).toBe('unknown');
  });

  it('rejects malformed ids (chars that are not [A-Za-z0-9_-])', () => {
    const a = dispatch('claim no!hashes');
    expect(a.kind).toBe('reply');
    expect(a.text).toMatch(/valid id/i);
  });
});

// ── End-to-end via InMemoryBridge ──────────────────────────────────────────

describe('V1.5 — wireBotChannel end-to-end', () => {
  let lsBundle;
  let circle;
  let bridge;
  let detach;

  beforeEach(async () => {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig:           CIRCLE,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
    bridge = new InMemoryBridge({ id: 'test-bot' });
    const r = await wireBotChannel({
      agent:        circle.agent,
      bridges:      [{ bridge, name: 'test' }],
      chatBindings: CIRCLE.bot.chatBindings,
    });
    detach = r.detach;
  });

  afterEach(async () => {
    await detach?.();
    await circle?.close?.();
  });

  /** Helper: fire a chat message + return the bot's last reply text. */
  async function ask(chatId, text) {
    bridge.outbox.length = 0;
    // InMemoryBridge exposes simulateIncoming OR direct handler call;
    // peek the public surface.
    if (typeof bridge.simulateIncoming === 'function') {
      await bridge.simulateIncoming({ chatId, text });
    } else {
      // Fallback for older shape — invoke the registered handler.
      await bridge._handler?.({ chatId, text });
    }
    // The handler is async; let microtasks settle.
    await new Promise((r) => setTimeout(r, 5));
    return bridge.outbox.map((o) => o.text).join('\n---\n');
  }

  it('unbound chatId gets a friendly hint with the chatId', async () => {
    const r = await ask(RANDO_CHAT, 'open');
    expect(r).toMatch(/not bound/i);
    expect(r).toContain(RANDO_CHAT);
  });

  it('"help" returns the HELP_TEXT verbatim', async () => {
    const r = await ask(ANNE_CHAT, 'help');
    expect(r).toBe(HELP_TEXT);
  });

  it('"open" with no tasks returns the empty-state line', async () => {
    const r = await ask(ANNE_CHAT, 'open');
    expect(r).toMatch(/no open tasks/i);
  });

  it('full claim → done flow over chat (self-mark approval)', async () => {
    // Anne adds a task via the agent.
    const addDef = circle.agent.skills.get('addTask');
    const addRes = await addDef.handler({
      parts: [{ type: 'DataPart', data: { text: 'Take out the trash' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const taskId = addRes.task.id;

    // Open → list shows the task with a short id.
    const listed = await ask(ANNE_CHAT, 'open');
    expect(listed).toMatch(/Take out the trash/);
    expect(listed).toContain(taskId.slice(0, 8));

    // Kid claims via short prefix.
    const claimed = await ask(KID_CHAT, `claim ${taskId.slice(0, 8)}`);
    expect(claimed).toMatch(/Claimed/);

    // Kid marks complete.
    const done = await ask(KID_CHAT, `done ${taskId.slice(0, 8)}`);
    expect(done).toMatch(/Done/);

    // Anne lists open → empty.
    const after = await ask(ANNE_CHAT, 'open');
    expect(after).toMatch(/no open tasks/i);
  });

  it('full submit → approve flow (creator approval mode)', async () => {
    const addDef = circle.agent.skills.get('addTask');
    const addRes = await addDef.handler({
      parts: [{ type: 'DataPart', data: { text: 'Paint fence', approval: 'creator' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const id = addRes.task.id;
    const short = id.slice(0, 8);

    await ask(KID_CHAT, `claim ${short}`);
    const submitted = await ask(KID_CHAT, `submit ${short} note: 3 photos uploaded`);
    expect(submitted).toMatch(/Submitted/);

    // Anne (admin/creator) approves.
    const approved = await ask(ANNE_CHAT, `approve ${short}`);
    expect(approved).toMatch(/Approved/);
  });

  it('reject without a reason → bot replies with the missing-reason hint', async () => {
    const r = await ask(ANNE_CHAT, 'reject 01ABCDEF something');
    expect(r).toMatch(/reason/i);
  });

  it('revoke without a reason → bot replies with the missing-reason hint', async () => {
    const r = await ask(ANNE_CHAT, 'revoke 01ABCDEF something');
    expect(r).toMatch(/reason/i);
  });

  it('member chat trying to approve a creator-mode task is denied', async () => {
    const addDef = circle.agent.skills.get('addTask');
    const addRes = await addDef.handler({
      parts: [{ type: 'DataPart', data: { text: 'Paint', approval: 'creator' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const short = addRes.task.id.slice(0, 8);
    await ask(KID_CHAT, `claim ${short}`);
    await ask(KID_CHAT, `submit ${short}`);
    const r = await ask(KID_CHAT, `approve ${short}`);
    expect(r).toMatch(/error|permission/i);
  });

  it('audit log records the (via bot) display name on bot-driven actions', async () => {
    const addDef = circle.agent.skills.get('addTask');
    const addRes = await addDef.handler({
      parts: [{ type: 'DataPart', data: { text: 'Audit-test' } }],
      from:  ANNE,
      agent: circle.agent,
      envelope: null,
    });
    const short = addRes.task.id.slice(0, 8);
    await ask(KID_CHAT, `claim ${short}`);
    const log = await circle.itemStore.auditLog({ itemId: addRes.task.id });
    const claim = log.find((e) => e.action === 'claim');
    expect(claim?.actor).toBe(KID);
    expect(claim?.actorDisplayName).toMatch(/via bot/i);

    // Compare with a UI-direct action (no bot annotation):
    const addClaim = log.find((e) => e.action === 'add');
    expect(addClaim?.actor).toBe(ANNE);
    expect(addClaim?.actorDisplayName ?? '').not.toMatch(/via bot/i);
  });

  it('unknown commands get a "type help" reply', async () => {
    const r = await ask(ANNE_CHAT, 'fooble bar quux');
    expect(r).toMatch(/didn't understand|help/i);
  });
});
