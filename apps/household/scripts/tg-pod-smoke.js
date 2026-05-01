#!/usr/bin/env node
/**
 * tg-pod-smoke.js — Layer 3 outer-ring test harness.
 *
 * Real Telegram bot wired to:
 *   - TelegramBridge (real telegraf, long-polling default)
 *   - HouseholdAgent
 *   - HybridPodStore (the production-shape store) over
 *     HybridPodOrchestrator over real HouseholdPod / BotPod /
 *     MemberPod, all backed by an in-process filesystem-mock
 *     PodClient that persists to a JSON file.
 *   - LlmClient + ollamaProvider (Path-2 slow path)
 *
 * What this validates that Layer 2 doesn't:
 *   - HybridPodStore swap-in for InMemoryStore (the migration test)
 *   - HybridPodOrchestrator routing real ItemTypes to the right pod
 *   - HouseholdPod / BotPod / MemberPod against a "real-shaped"
 *     PodClient (read returning { content, contentType, ... }, list
 *     returning { container, entries: [{ uri }] }, etc.)
 *   - **State survives bot restarts** (the persist file holds
 *     everything — restart, /list shopping, items still there)
 *
 * What this DOES NOT validate (Layer 3-real, deferred):
 *   - Real Solid OIDC auth (no auth at all here)
 *   - DPoP (Inrupt's stricter write requirement)
 *   - Capability tokens / encryption-by-ACL ACL enforcement
 *   - Network errors
 *
 * Configuration (env):
 *   HOUSEHOLD_TG_BOT_TOKEN           required (BotFather)
 *   HOUSEHOLD_TG_USERNAME            optional (auto-detected)
 *   HOUSEHOLD_TG_MODE                'long-polling' (default) | 'webhook'
 *   HOUSEHOLD_TG_WEBHOOK_URL         required if mode=webhook
 *   HOUSEHOLD_TG_PORT                webhook port (default 3000)
 *
 *   HOUSEHOLD_LLM_PROVIDER           'ollama' (default) | 'openai' | 'anthropic'
 *   HOUSEHOLD_LLM_MODEL              override default
 *   HOUSEHOLD_DISABLE_LLM=1          drop to Layer 1 (regex only)
 *
 *   HOUSEHOLD_POD_PERSIST            path to the JSON persist file
 *                                     (default ~/.local/share/household-h2-test/pod.json)
 *   HOUSEHOLD_HOUSEHOLD_POD_ROOT     default https://test.example/h2-household/
 *   HOUSEHOLD_BOT_POD_ROOT           default https://test.example/h2-bot/
 *   HOUSEHOLD_MEMBER_POD_ROOT_TPL    default https://test.example/h2-member-{webid}/
 *
 * Usage:
 *   export HOUSEHOLD_TG_BOT_TOKEN=...
 *   npm run tg-pod-smoke --prefix apps/household
 *
 *   # wipe state to start fresh
 *   rm ~/.local/share/household-h2-test/pod.json
 *
 *   # inspect the pod contents
 *   jq . ~/.local/share/household-h2-test/pod.json
 *
 * Ctrl-C to stop.
 */

import { promises as fs } from 'node:fs';
import { dirname }        from 'node:path';
import os                 from 'node:os';

import { HouseholdAgent }    from '../src/HouseholdAgent.js';
import { TelegramBridge }    from '../src/bridges/TelegramBridge.js';
import { LlmClient }         from '../src/llm/LlmClient.js';
import { ollamaProvider }    from '../src/llm/providers/ollama.js';
import { openaiProvider }    from '../src/llm/providers/openai.js';
import { anthropicProvider } from '../src/llm/providers/anthropic.js';

import { HouseholdPod }            from '../src/pods/HouseholdPod.js';
import { BotPod }                  from '../src/pods/BotPod.js';
import { MemberPod }               from '../src/pods/MemberPod.js';
import { HybridPodOrchestrator }   from '../src/pods/HybridPodOrchestrator.js';
import { HybridPodStore }          from '../src/pods/HybridPodStore.js';

// ── Tiny filesystem-backed mock PodClient ─────────────────────────
//
// Implements the surface HouseholdPod / BotPod / MemberPod use:
//   read(uri, { decode? })           → { content, contentType, ... }
//   write(uri, content, { contentType, ... })
//   list(container, { recursive? })  → { container, entries: [{ uri }] }
//   delete(uri)
//   append(uri, line)                → for BotPod's audit jsonl
//
// Persists to one JSON file shared across all instances.  Multiple
// "pods" are simulated by giving each its own podRoot URL; entries
// in the same Map but with different URI prefixes.

class FsMockPod {
  constructor({ persistFile }) {
    this.persistFile = persistFile;
    this.store = new Map();          // uri → { content, contentType, lastModified, etag, size }
    this.tombstones = new Set();
    this._etagCounter = 0;
    this._loaded = false;
  }
  async _load() {
    if (this._loaded) return;
    this._loaded = true;
    if (!this.persistFile) return;
    try {
      const text = await fs.readFile(this.persistFile, 'utf8');
      const raw = JSON.parse(text);
      this.store = new Map(Object.entries(raw.store ?? {}));
      this.tombstones = new Set(raw.tombstones ?? []);
      this._etagCounter = raw.etagCounter ?? 0;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  async _flush() {
    if (!this.persistFile) return;
    await fs.mkdir(dirname(this.persistFile), { recursive: true });
    await fs.writeFile(this.persistFile, JSON.stringify({
      store: Object.fromEntries(this.store),
      tombstones: [...this.tombstones],
      etagCounter: this._etagCounter,
    }), 'utf8');
  }

  async read(uri, opts = {}) {
    await this._load();
    const r = this.store.get(uri);
    if (!r) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let content = r.content;
    if (opts.decode === 'json') {
      try { content = JSON.parse(content); }
      catch { /* leave as string */ }
    }
    return { ...r, content };
  }

  async write(uri, content, opts = {}) {
    await this._load();
    const text = typeof content === 'string'
      ? content
      : JSON.stringify(content);
    const stored = {
      content: text,
      contentType: opts.contentType || (typeof content === 'string' ? 'text/plain' : 'application/json'),
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: Buffer.byteLength(text, 'utf8'),
    };
    this.store.set(uri, stored);
    this.tombstones.delete(uri);
    await this._flush();
    return { uri, ...stored };
  }

  async list(container) {
    await this._load();
    const entries = [];
    for (const uri of this.store.keys()) {
      if (uri.startsWith(container) && uri !== container) entries.push({ uri });
    }
    return { container, entries };
  }

  async delete(uri) {
    await this._load();
    if (!this.store.has(uri)) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    this.store.delete(uri);
    this.tombstones.add(uri);
    await this._flush();
  }

  /** BotPod's audit log appender — line-delimited JSON. */
  async append(uri, line) {
    await this._load();
    const existing = this.store.get(uri);
    const newText = existing ? existing.content + line : line;
    return this.write(uri, newText, { contentType: 'application/x-ndjson' });
  }
}

// ── LLM ───────────────────────────────────────────────────────────

function buildLlm() {
  if (process.env.HOUSEHOLD_DISABLE_LLM === '1') return null;
  const id = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
  let provider;
  switch (id) {
    case 'ollama':
      provider = ollamaProvider({
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
      break;
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY required');
      console.error('⚠  CLOUD PROVIDER ACTIVE — every freeform message goes to OpenAI.');
      provider = openaiProvider({ apiKey, baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL, model: process.env.HOUSEHOLD_LLM_MODEL });
      break;
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
      console.error('⚠  CLOUD PROVIDER ACTIVE — every freeform message goes to Anthropic.');
      provider = anthropicProvider({ apiKey, baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL, model: process.env.HOUSEHOLD_LLM_MODEL });
      break;
    }
    default: throw new Error(`Unknown HOUSEHOLD_LLM_PROVIDER: ${id}`);
  }
  return new LlmClient({
    provider,
    audit: (e) => {
      const tag = e.kind === 'llm.invoke.error' ? 'ERR' : 'OK ';
      console.error(`[llm.audit ${tag}] ${e.providerId}`);
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const token = process.env.HOUSEHOLD_TG_BOT_TOKEN;
  if (!token) { console.error('error: HOUSEHOLD_TG_BOT_TOKEN required.'); process.exit(2); }

  const persistFile = process.env.HOUSEHOLD_POD_PERSIST
    ?? `${os.homedir()}/.local/share/household-h2-test/pod.json`;
  const householdRoot = process.env.HOUSEHOLD_HOUSEHOLD_POD_ROOT ?? 'https://test.example/h2-household/';
  const botRoot       = process.env.HOUSEHOLD_BOT_POD_ROOT       ?? 'https://test.example/h2-bot/';
  const memberRootTpl = process.env.HOUSEHOLD_MEMBER_POD_ROOT_TPL ?? 'https://test.example/h2-member-{webid}/';

  // One PodClient mock backs all three "pods".  Different URI prefixes
  // = different pods at the orchestration level.
  const podClient = new FsMockPod({ persistFile });

  const householdPod = new HouseholdPod({ podClient, podRoot: householdRoot });
  // Bot pod is constructed but we only use it for audit later; the
  // current orchestrator doesn't route items there (Q-H2.6 lock —
  // bot pod is for bot state, not user items).
  // const botPod = new BotPod({ podClient, podRoot: botRoot });
  /* eslint-disable no-unused-vars */ const _botPod = new BotPod({ podClient, podRoot: botRoot });

  const memberPodFor = async (webid) => {
    const safeWebid = encodeURIComponent(String(webid).replace(/[^a-zA-Z0-9._-]/g, '_'));
    const podRoot = memberRootTpl.replace('{webid}', safeWebid);
    return new MemberPod({ podClient, podRoot, memberWebid: webid });
  };

  const orchestrator = new HybridPodOrchestrator({ householdPod, memberPodFor });
  const store        = new HybridPodStore({ orchestrator });

  const bridge = new TelegramBridge({
    botToken:    token,
    mode:        process.env.HOUSEHOLD_TG_MODE ?? 'long-polling',
    webhookUrl:  process.env.HOUSEHOLD_TG_WEBHOOK_URL,
    port:        process.env.HOUSEHOLD_TG_PORT ? Number(process.env.HOUSEHOLD_TG_PORT) : undefined,
    botUsername: process.env.HOUSEHOLD_TG_USERNAME,
  });

  const llm = buildLlm();
  const agent = new HouseholdAgent({ store, bridges: [bridge], llm });

  console.error('# tg-pod-smoke — Layer 3 (real telegram + LLM + hybrid pod over fs-mock)');
  console.error(`# tg-mode:      ${bridge.bridgeId}`);
  console.error(`# llm:          ${llm ? llm.providerId : 'disabled (Layer 1)'}`);
  console.error(`# pod persist:  ${persistFile}`);
  console.error(`# household:    ${householdRoot}`);
  console.error(`# bot:          ${botRoot}`);
  console.error(`# member-tpl:   ${memberRootTpl}`);
  console.error('# Ctrl-C to stop.\n');

  await agent.start();
  console.error('# bot is live.  State persists across restarts.\n');

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.error(`\n# ${sig} received, stopping…`);
    const hardExit = setTimeout(() => { console.error('# shutdown hung past 4s — hard exit'); process.exit(1); }, 4000);
    hardExit.unref?.();
    try { await agent.stop(); }
    catch (err) { console.error('# stop failed:', err?.message ?? err); }
    finally { clearTimeout(hardExit); process.exit(0); }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('tg-pod-smoke: fatal:', err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
