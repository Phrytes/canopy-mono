import { describe, it, expect, vi } from 'vitest';
import { renderChat } from '../src/index.js';

const baseManifest = {
  app:       'demo',
  itemTypes: ['task'],
  operations: [
    {
      id:    'addTask',
      verb:  'add',
      params: [
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: 'add a task' },
        slash: { command: '/add', match: { verbs: ['add'], body: 'match' } },
      },
    },
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [],
      surfaces: {
        ui:   { control: 'button', label: 'Take' },
      },
    },
    {
      id:    'help',
      verb:  'list',          // any allow-listed verb is fine for the test
      params: [],
      // No surfaces — no chat hint → description falls back to op.id.
    },
  ],
};

const skill = vi.fn(async (args, ctx) => ({
  replies:      [{ text: `did: ${JSON.stringify(args)} ${ctx.chatId}` }],
  stateUpdates: [{ kind: 'item.added', itemId: 'x', chatId: ctx.chatId }],
}));

const skillRegistry = {
  addTask: skill,
  claim:   skill,
  // help: missing on purpose — exercises the permissive path.
};

const toSkillCtx = (toolCtx) => ({
  chatId:      toolCtx.chatId,
  senderWebid: toolCtx.actorWebid,
  bridgeId:    toolCtx.bridgeId,
});

describe('renderChat — arg validation', () => {
  it('throws without manifest', () => {
    expect(() => renderChat(null, { skillRegistry, toSkillCtx })).toThrow(/manifest required/);
  });
  it('throws without skillRegistry', () => {
    expect(() => renderChat(baseManifest, { toSkillCtx })).toThrow(/skillRegistry required/);
  });
  it('throws without toSkillCtx', () => {
    expect(() => renderChat(baseManifest, { skillRegistry })).toThrow(/toSkillCtx required/);
  });
});

describe('renderChat — toolCatalog', () => {
  it('shape matches ChatAgent expectation + follows op declaration order', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx });
    expect(out.toolCatalog).toHaveLength(3);
    expect(out.toolCatalog.map((t) => t.id)).toEqual(['addTask', 'claim', 'help']);
    expect(out.toolCatalog[0]).toEqual({
      id:          'addTask',
      description: 'add a task',
      schema: {
        type:       'object',
        properties: { text: { type: 'string' } },
        required:   ['text'],
      },
    });
    // help: no surfaces.chat.hint → fall back to op.id as description.
    expect(out.toolCatalog[2].description).toBe('help');
  });
});

describe('renderChat — toolHandlers adapter', () => {
  it('reproduces buildHouseholdToolHandlers generically', async () => {
    const onStateUpdates = vi.fn();
    const out = renderChat(baseManifest, {
      skillRegistry, toSkillCtx, onStateUpdates,
    });

    skill.mockClear();
    onStateUpdates.mockClear();

    const result = await out.toolHandlers.addTask(
      { text: 'paint' },
      { chatId: 'c1', actorWebid: 'web:1', bridgeId: 'tg' },
    );

    // (1) skill called with toSkillCtx-mapped context.
    expect(skill).toHaveBeenCalledWith(
      { text: 'paint' },
      { chatId: 'c1', senderWebid: 'web:1', bridgeId: 'tg' },
    );

    // (2) stateUpdates forwarded via onStateUpdates (side-effect).
    expect(onStateUpdates).toHaveBeenCalledTimes(1);
    expect(onStateUpdates.mock.calls[0][0]).toEqual([
      { kind: 'item.added', itemId: 'x', chatId: 'c1' },
    ]);

    // (3) ToolResult shape: { replies, data: { stateUpdates } }.
    expect(result).toEqual({
      replies: [{ text: 'did: {"text":"paint"} c1' }],
      data:    { stateUpdates: [{ kind: 'item.added', itemId: 'x', chatId: 'c1' }] },
    });
  });

  it('permissive: ops with no skill in the registry are omitted', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx });
    expect(out.toolHandlers).toHaveProperty('addTask');
    expect(out.toolHandlers).toHaveProperty('claim');
    expect(out.toolHandlers).not.toHaveProperty('help');
  });

  it('does not call onStateUpdates when the skill returns no stateUpdates', async () => {
    const onStateUpdates = vi.fn();
    const quietSkill = async () => ({ replies: [{ text: 'ok' }], stateUpdates: [] });
    const out = renderChat(baseManifest, {
      skillRegistry: { addTask: quietSkill, claim: quietSkill },
      toSkillCtx, onStateUpdates,
    });
    const r = await out.toolHandlers.addTask({ text: 'x' }, { chatId: 'c' });
    expect(onStateUpdates).not.toHaveBeenCalled();
    expect(r.data.stateUpdates).toEqual([]);
  });
});

describe('renderChat — commandMenu', () => {
  it('includes ops with surfaces.slash.command only', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx });
    expect(out.commandMenu).toEqual([
      { command: '/add', description: 'add a task' },
    ]);
  });
});

describe('renderChat — inlineKeyboardFor', () => {
  it('filters by appliesTo and emits callbackData "<opId>:<itemId>"', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx });
    // Matching task in 'open' state — only `claim` applies.
    expect(out.inlineKeyboardFor({ id: 't1', type: 'task', state: 'open' })).toEqual([
      { label: 'Take', callbackData: 'claim:t1' },
    ]);
    // Wrong state — no buttons.
    expect(out.inlineKeyboardFor({ id: 't2', type: 'task', state: 'claimed' })).toEqual([]);
    // Wrong type — no buttons.
    expect(out.inlineKeyboardFor({ id: 'n1', type: 'note', state: 'open' })).toEqual([]);
  });

  it('F-SP3-a: appliesTo.state as array matches any state in the array', () => {
    const m = {
      app:       'demo',
      itemTypes: ['task'],
      operations: [{
        id:        'revokeTask',
        verb:      'revoke',
        appliesTo: { type: 'task', state: ['claimed', 'submitted', 'rejected'] },
        params:    [],
        surfaces:  { ui: { control: 'button', label: 'Revoke' } },
      }],
    };
    const out = renderChat(m, {
      skillRegistry: { revokeTask: async () => ({ replies: [], stateUpdates: [] }) },
      toSkillCtx:    (c) => c,
    });
    // Matches each state in the array.
    for (const state of ['claimed', 'submitted', 'rejected']) {
      expect(out.inlineKeyboardFor({ id: `t-${state}`, type: 'task', state })).toEqual([
        { label: 'Revoke', callbackData: `revokeTask:t-${state}` },
      ]);
    }
    // Does NOT match states outside the array.
    expect(out.inlineKeyboardFor({ id: 't-open',     type: 'task', state: 'open' })).toEqual([]);
    expect(out.inlineKeyboardFor({ id: 't-complete', type: 'task', state: 'complete' })).toEqual([]);
  });
});

describe('renderChat — systemPrompt', () => {
  it('is deterministic + uses the chat hint per op (fallback to id)', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx });
    expect(out.systemPrompt).toContain('"demo"');
    expect(out.systemPrompt).toContain('- addTask: add a task');
    expect(out.systemPrompt).toContain('- help: help');     // fallback
  });

  it('F-SP1-d: manifest.systemPrompt (string) is emitted verbatim', () => {
    const verbatim = 'EXACTLY THIS\n\nIncluding\n  weird whitespace.';
    const out = renderChat({ ...baseManifest, systemPrompt: verbatim }, {
      skillRegistry, toSkillCtx,
    });
    expect(out.systemPrompt).toBe(verbatim);
    // Custom prompt knobs are ignored when systemPrompt is set.
    const out2 = renderChat({ ...baseManifest, systemPrompt: verbatim }, {
      skillRegistry, toSkillCtx,
    }, { prompt: { preamble: 'IGNORED' } });
    expect(out2.systemPrompt).toBe(verbatim);
  });

  it('honours custom prompt knobs', () => {
    const out = renderChat(baseManifest, { skillRegistry, toSkillCtx }, {
      prompt: {
        preamble:    'CUSTOM PREAMBLE',
        perToolLine: (op) => `[${op.id}]`,
        postamble:   'END',
      },
    });
    expect(out.systemPrompt).toBe(
      ['CUSTOM PREAMBLE', '', 'Available tools:', '[addTask]', '[claim]', '[help]', '', 'END'].join('\n'),
    );
  });
});
