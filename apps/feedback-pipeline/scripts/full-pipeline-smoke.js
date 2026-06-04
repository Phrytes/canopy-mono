#!/usr/bin/env node
/**
 * full-pipeline-smoke.js — end-to-end: RAW DATA → clean → triage → final
 * per-domain summaries. Draws a ROTATING sample from fixtures/dataset.js each
 * run (partially new every time) for robustness.
 *
 * Writes ./results-fullpipeline.md with everything written out in full.
 *
 *   node scripts/full-pipeline-smoke.js
 *   FP_SAMPLE_N=14 FP_MODEL=qwen2.5:7b-instruct node scripts/full-pipeline-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { FULL_DATASET } from '../fixtures/dataset.js';
import { fullPipeline } from '../src/triage.js';
import { sample } from '../src/util.js';
import { PROMPT_VERSION, SUMMARIZE_VERSION } from '../src/prompts.js';
import { OLLAMA_BASE } from '../src/ollama.js';
import { PREFERRED_LANGUAGE, langName } from '../src/config.js';

const MODEL = process.env.FP_MODEL || 'qwen2.5:7b-instruct';
const N = Number(process.env.FP_SAMPLE_N || 12);
const log = (s) => process.stderr.write(s + '\n');

const batch = sample(FULL_DATASET, N); // rotating subset, new each run

(async () => {
  log(`full pipeline: ${N} of ${FULL_DATASET.length} messages, model ${MODEL} …`);
  const { signals, perMessage, summaryByDomain, labels } = await fullPipeline(MODEL, batch);

  const out = [];
  const W = (s = '') => out.push(s);
  W(`# Full pipeline — RAW → clean → translate → triage → summaries`);
  W(`\nclean v${PROMPT_VERSION}, summarize v${SUMMARIZE_VERSION}, preferred language **${langName(PREFERRED_LANGUAGE)}**, model ${MODEL}, Ollama @ ${OLLAMA_BASE}.`);
  W(`Rotating sample of ${batch.length}/${FULL_DATASET.length} messages (new each run). All synthetic.\n`);

  W(`## 0. Raw input (${batch.length} messages)\n`);
  batch.forEach((m, i) => W(`${i + 1}. ${m}`));
  W();

  W(`## 1. ⚠ Signal track — ${signals.length} incident(s) routed to escalation (NOT aggregated)\n`);
  if (!signals.length) W('_none_');
  for (const s of signals) {
    const how = s.crisisMatch ? 'crisis-lexicon' : s.safetyMatch ? 'safety-lexicon' : 'LLM';
    W(`- **${s.signal}** (severity ${s.severity}, via ${how}): ${s.raw}`);
  }
  W();

  W(`## 2. Per-message clean + translate (regular messages)\n`);
  for (const m of perMessage) {
    W(`- **[${m.domain}]** (${m.lang}${m.hits.length ? ', redacted: ' + m.hits.join(', ') : ''})`);
    W(`  - RAW:        ${m.raw}`);
    W(`  - CLEAN:      ${m.cleaned}`);
    if (m.translated !== m.cleaned) W(`  - TRANSLATED: ${m.translated}`);
  }
  W();

  W(`## 3. Final summaries by domain (built from the cleaned + translated messages)\n`);
  for (const [domain, text] of Object.entries(summaryByDomain)) {
    W(`**${domain}**`);
    W(text);
    W();
  }

  writeFileSync(new URL('../results-fullpipeline.md', import.meta.url), out.join('\n') + '\n');
  log('wrote results-fullpipeline.md');
})();
