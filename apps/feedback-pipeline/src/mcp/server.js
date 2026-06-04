// MCP server exposing the feedback-pipeline's ANONYMISED outputs as tools.
//
// Why MCP: Klai's chat layer (LibreChat) is an MCP *client* — it can't be fed
// our data directly, but it can connect to an MCP server we run. So instead of
// pushing documents into Klai's Knowledge store, the curator queries our
// anonymised tracks live, per question. The raw text never crosses this
// boundary (stripRaw below is the guarantee, mirroring docs/KLAI-evaluation.md).
//
// Transport: stdio (works with the MCP inspector, Claude Desktop/Code, and a
// self-hosted LibreChat on the same box). For a REMOTE Klai instance, swap in
// StreamableHTTPServerTransport + auth — same tools, see README-mcp.md.
//
// IMPORTANT (stdio rule): stdout is the protocol channel. NEVER console.log —
// all diagnostics go to stderr.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { aggregateWithThreshold } from '../aggregate.js';

const MODEL = process.env.FP_MODEL || 'qwen2.5:7b-instruct';

/** Defence in depth: strip any raw/original text from anything we return, so a
 *  future field rename can't leak un-anonymised data through the MCP boundary. */
function stripRaw(v) {
  if (Array.isArray(v)) return v.map(stripRaw);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'raw' || k === 'rawText' || k === 'rawMessages') continue;
      o[k] = stripRaw(val);
    }
    return o;
  }
  return v;
}

/** Load a saved aggregate-result JSON (a processed scenario). Path comes from
 *  the tool arg, else the FP_RESULTS env default. */
function loadResults(resultsPath) {
  const path = resultsPath || process.env.FP_RESULTS;
  if (!path) throw new Error('No results file. Set FP_RESULTS or pass resultsPath.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(stripRaw(obj), null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: String(msg) }] });

const server = new McpServer({ name: 'feedback-pipeline', version: '0.0.1' });

const PATH_ARG = { resultsPath: z.string().optional().describe('Path to a saved aggregate-result JSON; defaults to $FP_RESULTS.') };

server.registerTool('list_themes', {
  title: 'List statistical themes',
  description: 'Themes that met the k-anonymity threshold (≥k distinct users), with their user/message counts. Anonymised; no raw text.',
  inputSchema: PATH_ARG,
}, async ({ resultsPath }) => {
  try {
    const r = loadResults(resultsPath);
    return json((r.statistical || []).map((t) => ({ theme: t.theme, userCount: t.userCount, messageCount: t.messageCount })));
  } catch (e) { return fail(e.message); }
});

server.registerTool('get_theme_summary', {
  title: 'Get a theme summary',
  description: 'The deduplicated summary for one statistical theme.',
  inputSchema: { theme: z.string().describe('Theme label, as returned by list_themes.'), ...PATH_ARG },
}, async ({ theme, resultsPath }) => {
  try {
    const r = loadResults(resultsPath);
    const t = (r.statistical || []).find((x) => x.theme === theme);
    return t ? json(t) : fail(`No theme "${theme}". Use list_themes to see available themes.`);
  } catch (e) { return fail(e.message); }
});

server.registerTool('get_signals', {
  title: 'Get the signal track',
  description: 'Serious single-incident signals (crisis / medical-emergency / abuse / safety / harassment / integrity), with category, severity and detection source. Cleaned text only — never raw.',
  inputSchema: PATH_ARG,
}, async ({ resultsPath }) => {
  try { return json(loadResults(resultsPath).signals || []); } catch (e) { return fail(e.message); }
});

server.registerTool('get_review_queue', {
  title: 'Get the human-review (quarantine) queue',
  description: 'Sensitive below-threshold items quarantined for human review (not deleted), with per-message sensitivity flags. No raw text.',
  inputSchema: PATH_ARG,
}, async ({ resultsPath }) => {
  try { return json(loadResults(resultsPath).review || []); } catch (e) { return fail(e.message); }
});

server.registerTool('get_transparency_report', {
  title: 'Get the transparency report',
  description: 'Counts the pipeline is obliged to disclose: k-threshold, totals, rejected attempts (by reason), and below-threshold themes that were dropped (counts only).',
  inputSchema: PATH_ARG,
}, async ({ resultsPath }) => {
  try {
    const r = loadResults(resultsPath);
    const byReason = {};
    for (const x of r.rejected || []) byReason[x.reason] = (byReason[x.reason] || 0) + 1;
    return json({
      kThreshold: r.kThreshold, totalUsers: r.totalUsers, totalMessages: r.totalMessages,
      rejectedByReason: byReason, droppedThemes: r.dropped || [], contactRequests: (r.contact || []).length,
    });
  } catch (e) { return fail(e.message); }
});

server.registerTool('aggregate', {
  title: 'Run the pipeline on new messages',
  description: 'Clean + triage + k-anonymously aggregate a batch of raw feedback messages locally, returning ONLY the anonymised tracks (statistical / signals / review / contact / rejected). Raw text is never returned. Needs a local Ollama; slow on CPU.',
  inputSchema: {
    messages: z.array(z.object({
      user: z.string().describe('Pseudonymous contributor id (for k-anonymity counting).'),
      text: z.string(),
      lang: z.string().optional(),
    })).min(1).describe('Raw feedback messages to process.'),
    kThreshold: z.number().int().min(1).optional().describe('Minimum distinct users for a theme to surface (default 3).'),
  },
}, async ({ messages, kThreshold }) => {
  try {
    const r = await aggregateWithThreshold(MODEL, messages, kThreshold ? { kThreshold } : {});
    return json(r);
  } catch (e) { return fail(e.message); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[feedback-pipeline MCP] ready (model=${MODEL}, results=${process.env.FP_RESULTS || '(none)'})`);
