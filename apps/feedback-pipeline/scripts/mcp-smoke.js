// Headless smoke test for the MCP server: spawns it over stdio, lists tools,
// and calls the read-only tools against a saved results file. No Ollama needed
// (the live `aggregate` tool is exercised separately). Asserts the raw-text
// guarantee: no result may contain a "raw" field.
//
//   node scripts/mcp-smoke.js [resultsFile]   (default /tmp/b-out3.json)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const RESULTS = process.argv[2] || '/tmp/b-out3.json';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/mcp/server.js'],
  env: { ...process.env, FP_RESULTS: RESULTS },
});
const client = new Client({ name: 'mcp-smoke', version: '0' });
await client.connect(transport);

const parse = (res) => JSON.parse(res.content[0].text);
const assert = (cond, msg) => { if (!cond) { console.error('  ✗', msg); process.exitCode = 1; } else console.error('  ✓', msg); };

const { tools } = await client.listTools();
console.error('tools:', tools.map((t) => t.name).join(', '));
assert(tools.length === 6, 'exposes 6 tools');

const themes = parse(await client.callTool({ name: 'list_themes', arguments: {} }));
console.error('list_themes →', JSON.stringify(themes));
assert(Array.isArray(themes), 'list_themes returns an array');

const signals = parse(await client.callTool({ name: 'get_signals', arguments: {} }));
console.error('get_signals →', signals.length, 'signals;', signals.map((s) => s.signal).join(','));
assert(signals.every((s) => !('raw' in s)), 'no signal carries a raw field (anonymisation boundary)');

const report = parse(await client.callTool({ name: 'get_transparency_report', arguments: {} }));
console.error('transparency →', JSON.stringify(report));
assert(typeof report.kThreshold === 'number', 'transparency report has kThreshold');

await client.close();
console.error(process.exitCode ? '\nFAIL' : '\nOK');
