#!/usr/bin/env node
/**
 * clean-smoke.js — step 1 (regex) + step 2 (LLM) over CLEAN_FIXTURES,
 * across several models. For each fixture it shows:
 *   raw  →  regex-redacted (+ which identifier types were caught)  →  LLM-cleaned
 * and flags if the model dropped/mangled a [placeholder] token.
 *
 * Writes ./results-clean.md (next to this script's app root) and prints
 * progress to stderr.
 *
 *   node scripts/clean-smoke.js
 *   CLEAN_MODELS="qwen2.5:7b-instruct" node scripts/clean-smoke.js
 *   OLLAMA_URL=http://otherbox:11434 node scripts/clean-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { CLEAN_FIXTURES } from '../fixtures/messages.js';
import { cleanMessage, placeholdersPreserved } from '../src/pipeline.js';
import { PROMPT_VERSION } from '../src/prompts.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const MODELS = (process.env.CLEAN_MODELS ||
  'qwen2.5:7b-instruct,mistral:7b-instruct,qwen2.5:3b-instruct'
).split(',').map((s) => s.trim()).filter(Boolean);

const log = (s) => process.stderr.write(s + '\n');
const out = [];
out.push(`# Clean / anonymize — step1 regex + step2 LLM`);
out.push(`\nprompt v${PROMPT_VERSION}, temperature 0, Ollama @ ${OLLAMA_BASE}.`);
out.push(`Models: ${MODELS.join(', ')}\n`);

(async () => {
  for (const model of MODELS) {
    log(`\n=== ${model} ===`);
    out.push(`\n### ${model}\n`);
    out.push(`| id | lang (fx→detected) | raw → redacted (regex hits) → cleaned | ms | tokens kept |`);
    out.push(`|----|--------------------|----------------------------------------|----|-------------|`);
    for (const fx of CLEAN_FIXTURES) {
      log(`  ${model} ${fx.id} …`);
      // No userLang passed → pure detection, so the smoke also tests the detector.
      const r = await cleanMessage(model, fx.text);
      const hitTypes = r.hits.length ? r.hits.map((h) => h.type).join(', ') : '—';
      const kept = r.cleaned ? (placeholdersPreserved(r.redacted, r.cleaned) ? '✓' : '✗ DROPPED') : 'n/a';
      const langCell = `${fx.lang}→${r.lang}${r.lang === fx.lang ? '' : ' ⚠'}`;
      const cleaned = r.cleaned ? r.cleaned.replace(/\n+/g, ' ⏎ ') : `⚠ ${r.error}`;
      out.push(
        `| ${fx.id} | ${langCell} | **raw:** ${fx.text.replace(/\n+/g, ' ')}` +
        `<br>**redacted (${hitTypes}):** ${r.redacted.replace(/\n+/g, ' ')}` +
        `<br>**cleaned:** ${cleaned} | ${r.ms} | ${kept} |`
      );
    }
    writeFileSync(new URL('../results-clean.md', import.meta.url), out.join('\n') + '\n');
  }
  log('\nWrote results-clean.md');
})();
