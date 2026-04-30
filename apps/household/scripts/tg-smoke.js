#!/usr/bin/env node
/**
 * tg-smoke.js — Layer 2 outer-ring test harness.
 *
 * Runs a real Telegram bot wired to:
 *   - TelegramBridge (via telegraf, long-polling by default)
 *   - HouseholdAgent
 *   - InMemoryStore (no pod — items vanish on restart)
 *   - LlmClient + ollamaProvider (slow-path Path-2 fallback)
 *
 * Use this to flush out Telegram-specific bugs (privacy-mode,
 * mention stripping, button serialisation, etc.) AND validate the
 * hybrid routing on real chat traffic.
 *
 * Configuration (env):
 *
 *   HOUSEHOLD_TG_BOT_TOKEN       required.  From @BotFather.
 *   HOUSEHOLD_TG_USERNAME        optional.  Bot's @-handle without '@'.
 *                                If omitted, the bridge auto-detects via
 *                                bot.telegram.getMe() — costs one round-trip.
 *   HOUSEHOLD_TG_MODE            'long-polling' (default) | 'webhook'
 *   HOUSEHOLD_TG_WEBHOOK_URL     required if mode=webhook.  e.g. https://x.example/tg
 *   HOUSEHOLD_TG_PORT            webhook server port (default 3000)
 *
 *   HOUSEHOLD_LLM_PROVIDER       'ollama' (default) | 'openai' | 'anthropic'
 *   HOUSEHOLD_LLM_MODEL          override default model
 *   HOUSEHOLD_LLM_BASE_URL       override default base URL
 *   OPENAI_API_KEY               required if HOUSEHOLD_LLM_PROVIDER=openai
 *   ANTHROPIC_API_KEY            required if HOUSEHOLD_LLM_PROVIDER=anthropic
 *
 *   HOUSEHOLD_DISABLE_LLM=1      skip the LLM entirely (Layer 1 only).
 *
 * Usage:
 *   export HOUSEHOLD_TG_BOT_TOKEN=...
 *   npm run tg-smoke --prefix apps/household
 *
 *   # to skip the LLM (Layer 1):
 *   HOUSEHOLD_DISABLE_LLM=1 npm run tg-smoke --prefix apps/household
 *
 * Ctrl-C to stop.  Shutdown drains telegraf cleanly with a 4s
 * safety-net (mirrors Folio v2.12 / commit f40086e).
 */

import { HouseholdAgent }    from '../src/HouseholdAgent.js';
import { InMemoryStore }     from '../src/storage/InMemoryStore.js';
import { TelegramBridge }    from '../src/bridges/TelegramBridge.js';
import { LlmClient }         from '../src/llm/LlmClient.js';
import { ollamaProvider }    from '../src/llm/providers/ollama.js';
import { openaiProvider }    from '../src/llm/providers/openai.js';
import { anthropicProvider } from '../src/llm/providers/anthropic.js';

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
      if (!apiKey) throw new Error('OPENAI_API_KEY required when HOUSEHOLD_LLM_PROVIDER=openai');
      console.error('⚠  CLOUD PROVIDER ACTIVE — every freeform message goes to OpenAI.');
      provider = openaiProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
      break;
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY required when HOUSEHOLD_LLM_PROVIDER=anthropic');
      console.error('⚠  CLOUD PROVIDER ACTIVE — every freeform message goes to Anthropic.');
      provider = anthropicProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
      break;
    }
    default:
      throw new Error(`Unknown HOUSEHOLD_LLM_PROVIDER: ${id}`);
  }

  return new LlmClient({
    provider,
    audit: (entry) => {
      // Surface audit entries to stderr — for visibility while
      // smoke-testing.  In production this would write to BotPod.
      const tag = entry.kind === 'llm.invoke.error' ? 'ERR' : 'OK ';
      console.error(`[llm.audit ${tag}] ${entry.providerId} input=${JSON.stringify(entry.input.messages?.[0]?.content ?? '').slice(0, 80)}`);
    },
  });
}

async function main() {
  const token = process.env.HOUSEHOLD_TG_BOT_TOKEN;
  if (!token) {
    console.error('error: HOUSEHOLD_TG_BOT_TOKEN env var required.');
    console.error('  1. DM @BotFather on Telegram, run /newbot, follow prompts.');
    console.error('  2. Save the token (treat like a password).');
    console.error('  3. export HOUSEHOLD_TG_BOT_TOKEN=...');
    process.exit(2);
  }

  const mode = process.env.HOUSEHOLD_TG_MODE ?? 'long-polling';
  if (mode === 'webhook' && !process.env.HOUSEHOLD_TG_WEBHOOK_URL) {
    console.error('error: HOUSEHOLD_TG_MODE=webhook requires HOUSEHOLD_TG_WEBHOOK_URL.');
    process.exit(2);
  }

  const llm = buildLlm();

  const bridge = new TelegramBridge({
    botToken:    token,
    mode,
    webhookUrl:  process.env.HOUSEHOLD_TG_WEBHOOK_URL,
    port:        process.env.HOUSEHOLD_TG_PORT ? Number(process.env.HOUSEHOLD_TG_PORT) : undefined,
    botUsername: process.env.HOUSEHOLD_TG_USERNAME,
  });

  const store = new InMemoryStore();
  const agent = new HouseholdAgent({ store, bridges: [bridge], llm });

  // ── startup banner ──────────────────────────────────────────
  console.error('# tg-smoke (household-app outer ring) — Layer 2');
  console.error(`# tg-mode:     ${mode}`);
  console.error(`# llm:         ${llm ? llm.providerId : 'disabled (Layer 1)'}`);
  console.error('# storage:     InMemoryStore (items vanish on restart)');
  console.error('# pod:         none (Layer 3 not active)');
  console.error('# Ctrl-C to stop.\n');

  await agent.start();
  console.error('# bot is live.  Try in Telegram:');
  console.error('#   /add shopping bread');
  console.error('#   /list shopping');
  console.error('#   /done bread');
  console.error('#   "we need cocoa" (freeform → LLM if enabled)');
  console.error('#   /help\n');

  // ── graceful shutdown (mirrors Folio v2.12 — closeAllConnections + 4s hard-exit safety net) ──
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.error(`\n# ${sig} received, stopping…`);
    const hardExit = setTimeout(() => {
      console.error('# shutdown hung past 4s — hard exit');
      process.exit(1);
    }, 4000);
    hardExit.unref?.();
    try { await agent.stop(); }
    catch (err) { console.error('# stop failed:', err?.message ?? err); }
    finally {
      clearTimeout(hardExit);
      process.exit(0);
    }
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // Park.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('tg-smoke: fatal:', err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
