#!/usr/bin/env node
/**
 * pipeline-smoke.js — full step1→2→3 over SUMMARIZE_BATCH:
 *   1+2. clean every message (regex + LLM, with one CLEAN model)
 *   3.   summarize the cleaned set (with one or more SUMMARIZE models)
 *
 * Writes ./results-pipeline.md and prints progress to stderr.
 *
 *   node scripts/pipeline-smoke.js
 *   CLEAN_MODEL=qwen2.5:7b-instruct SUMMARIZE_MODELS="qwen2.5:7b-instruct,mistral:7b-instruct" node scripts/pipeline-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { SUMMARIZE_BATCH } from '../fixtures/messages.js';
import { cleanMessage, summarize } from '../src/pipeline.js';
import { PROMPT_VERSION } from '../src/prompts.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const CLEAN_MODEL = process.env.CLEAN_MODEL || 'qwen2.5:7b-instruct';
const SUMMARIZE_MODELS = (process.env.SUMMARIZE_MODELS ||
  'qwen2.5:7b-instruct,mistral:7b-instruct'
).split(',').map((s) => s.trim()).filter(Boolean);

const log = (s) => process.stderr.write(s + '\n');
const out = [];
out.push(`# Full pipeline — clean (${CLEAN_MODEL}) then summarize`);
out.push(`\nprompt v${PROMPT_VERSION}, temperature 0, Ollama @ ${OLLAMA_BASE}.`);
out.push(`Summarizers: ${SUMMARIZE_MODELS.join(', ')}\n`);

(async () => {
  // step 1 + 2: clean each message
  log(`\n=== clean with ${CLEAN_MODEL} ===`);
  out.push(`\n## Step 1+2 — cleaned messages (${CLEAN_MODEL})\n`);
  out.push(`| # | raw → cleaned |`);
  out.push(`|---|---------------|`);
  const cleanedTexts = [];
  for (let i = 0; i < SUMMARIZE_BATCH.length; i++) {
    log(`  clean ${i + 1}/${SUMMARIZE_BATCH.length} …`);
    const r = await cleanMessage(CLEAN_MODEL, SUMMARIZE_BATCH[i]);
    if (r.cleaned) cleanedTexts.push(r.cleaned);
    out.push(`| ${i + 1} | **raw:** ${SUMMARIZE_BATCH[i]}<br>**cleaned:** ${r.cleaned ? r.cleaned.replace(/\n+/g, ' ') : `⚠ ${r.error}`} |`);
  }

  // step 3: summarize the cleaned set with each summarizer
  for (const model of SUMMARIZE_MODELS) {
    log(`\n=== summarize with ${model} ===`);
    const r = await summarize(model, cleanedTexts);
    out.push(`\n## Step 3 — summary (${model}) — ${r.ms}ms\n`);
    out.push('```');
    out.push(r.ok ? r.text : `⚠ ${r.error}`);
    out.push('```');
    writeFileSync(new URL('../results-pipeline.md', import.meta.url), out.join('\n') + '\n');
  }
  log('\nWrote results-pipeline.md');
})();
