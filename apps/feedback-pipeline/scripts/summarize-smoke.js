#!/usr/bin/env node
/**
 * summarize-smoke.js — exercise ONLY step 3 (set summarization) over the
 * SUMMARIZE_BATCH, across models. Skips per-message cleaning so it's fast to
 * iterate on the summarize prompt (2 calls, not 12).
 *
 * Checks the two known failure modes by eye: deadline-bleed (a deadline on an
 * unrelated bullet) and dedup (ideal = 6 bullets for this batch).
 *
 *   node scripts/summarize-smoke.js
 *   SUMMARIZE_MODELS="qwen2.5:7b-instruct" node scripts/summarize-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { SUMMARIZE_BATCH } from '../fixtures/messages.js';
import { summarize } from '../src/pipeline.js';
import { SUMMARIZE_VERSION } from '../src/prompts.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const MODELS = (process.env.SUMMARIZE_MODELS ||
  'qwen2.5:7b-instruct,mistral:7b-instruct'
).split(',').map((s) => s.trim()).filter(Boolean);

const log = (s) => process.stderr.write(s + '\n');
const out = [];
out.push(`# Summarize-only smoke — a SET of ${SUMMARIZE_BATCH.length} messages`);
out.push(`\nsummarize prompt v${SUMMARIZE_VERSION}, temperature 0, Ollama @ ${OLLAMA_BASE}.`);
out.push(`Ideal = 6 bullets (milk/bread ×3, washing machine ×2, rent ×2 merge; dishes, parcel, dentist singletons).`);
out.push(`\nInput batch (with duplicates):\n`);
out.push('```');
SUMMARIZE_BATCH.forEach((m, i) => out.push(`${i + 1}. ${m}`));
out.push('```');

(async () => {
  for (const model of MODELS) {
    log(`summarize ${model} …`);
    const r = await summarize(model, SUMMARIZE_BATCH);
    out.push(`\n## ${model} — ${r.ms}ms\n`);
    out.push('```');
    out.push(r.ok ? r.text : `⚠ ${r.error}`);
    out.push('```');
    writeFileSync(new URL('../results-summarize.md', import.meta.url), out.join('\n') + '\n');
  }
  log('wrote results-summarize.md');
})();
