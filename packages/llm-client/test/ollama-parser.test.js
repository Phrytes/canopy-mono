import { describe, it, expect } from 'vitest';
import {
  parseOpenAIChatResponse,
  parseLooseToolCall,
  parseLooseToolCalls,
  ollamaProvider,
} from '../src/providers/ollama.js';

const HOUSEHOLD_DESCRIPTORS = [
  {
    id: 'addToList',
    schema: {
      type: 'object',
      properties: { listName: { type: 'string' }, item: { type: 'string' } },
      required: ['listName', 'item'],
    },
  },
  {
    id: 'removeFromList',
    schema: {
      type: 'object',
      properties: { listName: { type: 'string' }, match: { type: 'string' } },
      required: ['listName', 'match'],
    },
  },
  {
    id: 'showList',
    schema: {
      type: 'object',
      properties: { listName: { type: 'string' } },
      required: ['listName'],
    },
  },
];

describe('parseOpenAIChatResponse', () => {
  it('parses a native single tool_call', () => {
    const resp = {
      choices: [{ message: { tool_calls: [
        { function: { name: 'addItems', arguments: '{"items":[{"text":"a"}]}' } },
      ] } }],
    };
    const r = parseOpenAIChatResponse(resp);
    expect(r.classification).toBe('actionable');
    expect(r.toolCall).toEqual({ id: 'addItems', args: { items: [{ text: 'a' }] } });
    expect(r.toolCalls).toBeUndefined();
  });

  it('parses multiple tool_calls; toolCall is first, toolCalls has all', () => {
    const resp = {
      choices: [{ message: { tool_calls: [
        { function: { name: 'addItems',     arguments: '{}' } },
        { function: { name: 'markComplete', arguments: '{}' } },
      ] } }],
    };
    const r = parseOpenAIChatResponse(resp);
    expect(r.toolCall.id).toBe('addItems');
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[1].id).toBe('markComplete');
  });

  it('detects the literal "noise" reply (case-insensitive, with punctuation)', () => {
    for (const content of ['noise', 'NOISE', '"noise"', 'noise.', '  noise!  ']) {
      const r = parseOpenAIChatResponse({ choices: [{ message: { content } }] });
      expect(r.classification).toBe('noise');
      expect(r.replyText).toBeNull();
    }
  });

  it('detects "classification": "noise" JSON noise', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: '{"classification": "noise"}' } }],
    });
    expect(r.classification).toBe('noise');
  });

  it('falls through to free reply text when no tool call and no noise marker', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: 'hello there' } }],
    });
    expect(r.classification).toBeNull();
    expect(r.replyText).toBe('hello there');
  });

  it('detects loose JSON-blob tool-call in text', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: '{"tool":"addItems","args":{"items":[{"text":"x"}]}}' } }],
    });
    expect(r.classification).toBe('actionable');
    expect(r.toolCall.id).toBe('addItems');
  });
});

describe('parseLooseToolCall', () => {
  it('returns null for non-JSON text', () => {
    expect(parseLooseToolCall('hello')).toBeNull();
    expect(parseLooseToolCall('')).toBeNull();
    expect(parseLooseToolCall(null)).toBeNull();
  });

  it('returns null for valid JSON without tool/args shape', () => {
    expect(parseLooseToolCall('{"foo": 1}')).toBeNull();
    expect(parseLooseToolCall('[]')).toBeNull();
  });

  it('parses {tool, args} shape', () => {
    expect(parseLooseToolCall('{"tool": "addItem", "args": {"text": "x"}}'))
      .toEqual({ id: 'addItem', args: { text: 'x' } });
  });

  // ─── v0.2.0 — extended shapes ────────────────────────────────

  it('parses OpenAI {name, arguments} shape', () => {
    expect(parseLooseToolCall('{"name": "showList", "arguments": {"listName": "boodschappen"}}'))
      .toEqual({ id: 'showList', args: { listName: 'boodschappen' } });
  });

  it('parses {name, arguments} where arguments is a JSON string', () => {
    expect(parseLooseToolCall('{"name": "showList", "arguments": "{\\"listName\\":\\"boodschappen\\"}"}'))
      .toEqual({ id: 'showList', args: { listName: 'boodschappen' } });
  });

  it('parses nested {function: {name, arguments}} shape', () => {
    expect(parseLooseToolCall('{"function": {"name": "addToList", "arguments": {"listName":"x","item":"y"}}}'))
      .toEqual({ id: 'addToList', args: { listName: 'x', item: 'y' } });
  });

  it('recovers a JSON blob with leading text noise', () => {
    expect(parseLooseToolCall('blings\n{"name": "showList", "arguments": {"listName": "klusjes"}}'))
      .toEqual({ id: 'showList', args: { listName: 'klusjes' } });
  });

  it('recovers JSON blob in markdown code fence', () => {
    const text = '```json\n{"name":"showList","arguments":{"listName":"x"}}\n```';
    expect(parseLooseToolCall(text)).toEqual({ id: 'showList', args: { listName: 'x' } });
  });

  it('parseLooseToolCalls returns empty for plain text', () => {
    expect(parseLooseToolCalls('hello world')).toEqual([]);
  });

  it('parseLooseToolCalls recovers multiple JSON blobs in one reply', () => {
    const text = 'first: {"name":"addToList","arguments":{"listName":"b","item":"melk"}} ' +
                 'second: {"name":"addToList","arguments":{"listName":"b","item":"brood"}}';
    const calls = parseLooseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].args.item).toBe('melk');
    expect(calls[1].args.item).toBe('brood');
  });
});

describe('parseLooseToolCalls — JS-call syntax (with tool descriptors)', () => {
  it('positional args mapped to schema parameter order', () => {
    const calls = parseLooseToolCalls(
      'addToList("boodschappen", "kaas")',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toEqual([{ id: 'addToList', args: { listName: 'boodschappen', item: 'kaas' } }]);
  });

  it('named args (key="value")', () => {
    const calls = parseLooseToolCalls(
      'showList(listName="boodschappen")',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toEqual([{ id: 'showList', args: { listName: 'boodschappen' } }]);
  });

  it('multiple JS-calls in one reply', () => {
    const calls = parseLooseToolCalls(
      'Sure thing!\naddToList("boodschappen", "kaas")\naddToList("boodschappen", "boter")',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].args.item).toBe('kaas');
    expect(calls[1].args.item).toBe('boter');
  });

  it('mistral-style: removeFromList("boodschappen","kaas") with quotes', () => {
    const calls = parseLooseToolCalls(
      'RemoveFromList("boodschappen","kaas") {"match": "kaas"} ✓',
      { descriptors: [
        { id: 'RemoveFromList', schema: HOUSEHOLD_DESCRIPTORS[1].schema },
        ...HOUSEHOLD_DESCRIPTORS,
      ] },
    );
    // RemoveFromList (the actual emitted name) should match
    expect(calls.find((c) => c.id === 'RemoveFromList')).toBeTruthy();
  });

  it('does not match a tool inside a longer identifier', () => {
    const calls = parseLooseToolCalls(
      'doAddToListThing("x", "y")',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toEqual([]);
  });

  it('does not double-count when JSON blob and JS-call have the same content', () => {
    const calls = parseLooseToolCalls(
      'addToList("boodschappen", "kaas")\n{"name":"addToList","arguments":{"listName":"boodschappen","item":"kaas"}}',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toHaveLength(1);
  });

  it('returns empty for JS-call without descriptors', () => {
    expect(parseLooseToolCalls('addToList("x", "y")')).toEqual([]);
  });

  it('recovers escaped-brace JSON (mistral emits "\\{ ... \\}")', () => {
    const calls = parseLooseToolCalls(
      '\\{ "name": "showList", "arguments": { "listName": "boodschappen" } \\}',
    );
    expect(calls).toEqual([{ id: 'showList', args: { listName: 'boodschappen' } }]);
  });
});

describe('parseLooseToolCalls — natural-language fallback (Dutch + English)', () => {
  it('"appels is klaar" → removeFromList', () => {
    const calls = parseLooseToolCalls(
      '❌ appels is klaar, mark done.',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('removeFromList');
    expect(calls[0].args.match).toBe('appels');
    expect(calls[0].args.listName).toBe('boodschappen');           // default
  });

  it('uses mentioned list name when present in text', () => {
    const calls = parseLooseToolCalls(
      'timmeren is klaar op klusjes',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls[0].args.listName).toBe('klusjes');
  });

  it('"verwijder X" → removeFromList', () => {
    const calls = parseLooseToolCalls(
      'verwijder kaas',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls[0].id).toBe('removeFromList');
    expect(calls[0].args.match).toBe('kaas');
  });

  it('English "X is done" → removeFromList', () => {
    const calls = parseLooseToolCalls(
      'milk is done.',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls[0].id).toBe('removeFromList');
    expect(calls[0].args.match).toBe('milk');
  });

  it('does not fire when descriptors list lacks the tool id', () => {
    const calls = parseLooseToolCalls(
      'appels is klaar',
      { descriptors: [{ id: 'addToList', schema: HOUSEHOLD_DESCRIPTORS[0].schema }] },
    );
    expect(calls).toEqual([]);
  });

  it('rejects pronoun-only matches', () => {
    const calls = parseLooseToolCalls(
      'het is klaar',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(calls).toEqual([]);
  });

  it('can be disabled via naturalLanguage: false', () => {
    const calls = parseLooseToolCalls(
      'appels is klaar',
      { descriptors: HOUSEHOLD_DESCRIPTORS, naturalLanguage: false },
    );
    expect(calls).toEqual([]);
  });

  it('JSON match takes precedence; NL pattern doesn\'t double-add', () => {
    const calls = parseLooseToolCalls(
      '{"name":"removeFromList","arguments":{"listName":"boodschappen","match":"appels"}}\nappels is klaar',
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    // JSON gives us the removeFromList call; NL pattern would add
    // a duplicate but sameCall() dedupes them.
    expect(calls).toHaveLength(1);
    expect(calls[0].args.match).toBe('appels');
  });
});

describe('parseOpenAIChatResponse — natural-language preserved through loose recovery', () => {
  it('keeps "Toegevoegd!" as replyText when JSON is extracted', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content:
        '{"name":"addToList","arguments":{"listName":"boodschappen","item":"melk"}}\nToegevoegd!' } }],
    });
    expect(r.toolCall).toEqual({ id: 'addToList', args: { listName: 'boodschappen', item: 'melk' } });
    expect(r.replyText).toBe('Toegevoegd!');
  });

  it('strips multiple JSON blobs, preserves trailing prose', () => {
    const text =
      '{"name":"addToList","arguments":{"listName":"b","item":"melk"}}\n' +
      '{"name":"addToList","arguments":{"listName":"b","item":"brood"}}\n' +
      'Toegevoegd: melk en brood!';
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: text } }],
    });
    expect(r.toolCalls).toHaveLength(2);
    expect(r.replyText).toBe('Toegevoegd: melk en brood!');
  });

  it('replyText is null when only JSON, no surrounding text', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content:
        '{"name":"addToList","arguments":{"listName":"b","item":"melk"}}' } }],
    });
    expect(r.toolCall).toBeTruthy();
    expect(r.replyText).toBeNull();
  });

  it('preserves prose AROUND the JSON (prefix + JSON + suffix)', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content:
        'Sure!\n{"name":"addToList","arguments":{"listName":"b","item":"melk"}}\nDone.' } }],
    });
    expect(r.toolCall).toBeTruthy();
    // After stripping the JSON blob, the surrounding newlines remain
    // (collapsed only at 3+).  Acceptable — the prose is preserved.
    expect(r.replyText).toContain('Sure!');
    expect(r.replyText).toContain('Done.');
  });
});

describe('ollamaProvider — defaultOptions + stop', () => {
  it('sends temperature + stop when set on the provider', async () => {
    let captured;
    const fakeFetch = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = ollamaProvider({
      model:   'qwen2.5:3b',
      fetchFn: fakeFetch,
      defaultOptions: { temperature: 0.1, stop: ['\nUser:', '\nReply:'] },
    });
    await provider.invoke({
      system:   's',
      messages: [{ role: 'user', content: 'hi' }],
      tools:    [],
    });
    expect(captured.temperature).toBe(0.1);
    expect(captured.stop).toEqual(['\nUser:', '\nReply:']);
  });

  it('per-call options override provider defaults', async () => {
    let captured;
    const fakeFetch = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = ollamaProvider({
      model:   'qwen2.5:3b',
      fetchFn: fakeFetch,
      defaultOptions: { temperature: 0.1 },
    });
    await provider.invoke({
      system:   's',
      messages: [{ role: 'user', content: 'hi' }],
      tools:    [],
      options:  { temperature: 0.7 },          // per-call override
    });
    expect(captured.temperature).toBe(0.7);
  });

  it('without defaultOptions or options, sends no temperature/stop', async () => {
    let captured;
    const fakeFetch = async (url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = ollamaProvider({ model: 'qwen2.5:3b', fetchFn: fakeFetch });
    await provider.invoke({
      system:   's',
      messages: [{ role: 'user', content: 'hi' }],
      tools:    [],
    });
    expect(captured.temperature).toBeUndefined();
    expect(captured.stop).toBeUndefined();
  });
});

describe('ollamaProvider — apiKey (Privatemode / OpenAI-gateway auth)', () => {
  const okResp = () => new Response(
    JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  it('sends Authorization: Bearer <key> + posts to /v1/chat/completions when apiKey is set', async () => {
    let captured;
    const fakeFetch = async (url, init) => { captured = { url, headers: init.headers }; return okResp(); };
    const provider = ollamaProvider({
      baseUrl: 'http://localhost:8080',          // Privatemode loopback proxy root
      model:   'gpt-oss-120b',
      apiKey:  'pm-project-key-123',
      fetchFn: fakeFetch,
    });
    await provider.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(captured.url).toBe('http://localhost:8080/v1/chat/completions');
    expect(captured.headers.Authorization).toBe('Bearer pm-project-key-123');
  });

  it('sends NO Authorization header when apiKey is unset (local Ollama unchanged)', async () => {
    let captured;
    const fakeFetch = async (url, init) => { captured = init.headers; return okResp(); };
    const provider = ollamaProvider({ fetchFn: fakeFetch });   // no apiKey
    await provider.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(captured.Authorization).toBeUndefined();
  });
});

describe('parseOpenAIChatResponse — loose-recovery integration', () => {
  it('recovers JS-call from text content via descriptors', () => {
    const r = parseOpenAIChatResponse(
      { choices: [{ message: { content: 'Sure! addToList("boodschappen", "kaas")' } }] },
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(r.classification).toBe('actionable');
    expect(r.toolCall).toEqual({ id: 'addToList', args: { listName: 'boodschappen', item: 'kaas' } });
  });

  it('populates toolCalls[] when multiple loose calls found', () => {
    const r = parseOpenAIChatResponse(
      { choices: [{ message: { content:
        'addToList("b", "kaas")\naddToList("b", "boter")' } }] },
      { descriptors: HOUSEHOLD_DESCRIPTORS },
    );
    expect(r.toolCalls).toHaveLength(2);
  });

  it('OpenAI {name, arguments} JSON in text recovers cleanly', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: '{"name": "showList", "arguments": {"listName": "boodschappen"}}' } }],
    });
    expect(r.toolCall).toEqual({ id: 'showList', args: { listName: 'boodschappen' } });
  });
});
