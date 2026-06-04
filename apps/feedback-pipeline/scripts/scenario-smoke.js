#!/usr/bin/env node
/**
 * scenario-smoke.js — run the FULL upgraded pipeline over the commercial-
 * direction scenarios (fixtures/scenarios.js):
 *   • per-message clean  (regex + BSN + names + lang-routed de-intensify clean)
 *   • triage the batch   (signal track + per-domain summarize)
 *
 * Writes ./results-scenarios-upgraded.md with every message written out in full
 * (no truncation). One model (default qwen2.5:7b) for all steps.
 *
 *   node scripts/scenario-smoke.js
 *   SCENARIO_IDS="C,D" node scripts/scenario-smoke.js
 *   SCENARIO_MODEL=qwen2.5:7b-instruct node scripts/scenario-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { SCENARIOS } from '../fixtures/scenarios.js';
import { cleanMessage } from '../src/pipeline.js';
import { triageSummarize } from '../src/triage.js';
import { PROMPT_VERSION, SUMMARIZE_VERSION } from '../src/prompts.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const MODEL = process.env.SCENARIO_MODEL || 'qwen2.5:7b-instruct';
const ONLY = (process.env.SCENARIO_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SELECTED = ONLY.length ? SCENARIOS.filter((s) => ONLY.includes(s.id)) : SCENARIOS;
const log = (s) => process.stderr.write(s + '\n');

const out = [];
const W = (s = '') => out.push(s);
const FILE = new URL('../results-scenarios-upgraded.md', import.meta.url);

W(`# Scenario results — UPGRADED pipeline`);
W(`\nclean prompt v${PROMPT_VERSION} (de-intensify), deterministic BSN, triage (signal track + per-domain summarize v${SUMMARIZE_VERSION}).`);
W(`Model ${MODEL}, Ollama @ ${OLLAMA_BASE}. All fixtures synthetic.\n`);

(async () => {
  for (const sc of SELECTED) {
    log(`\n=== ${sc.id}: ${sc.name} ===`);
    W(`\n---\n\n# Scenario ${sc.id} — ${sc.name}\n`);

    W(`## Per-message clean (user default language: ${sc.userDefault})\n`);
    for (const fx of sc.clean) {
      log(`  clean ${fx.id} …`);
      const r = await cleanMessage(MODEL, fx.text, { userLang: sc.userDefault });
      const hits = r.hits.length ? r.hits.map((h) => h.type).join(', ') : 'none';
      W(`### ${fx.id}  (lang ${sc.userDefault}→${r.lang})`);
      W(`- **RAW:** ${fx.text}`);
      W(`- **REDACTED** (regex+names caught: ${hits}): ${r.redacted}`);
      W(`- **CLEAN:** ${r.cleaned ?? '⚠ ' + r.error}`);
      W();
    }

    log(`  triage batch (${sc.batch.length}) …`);
    const { signals, summaryByDomain, labels } = await triageSummarize(MODEL, sc.batch, {});
    W(`## Triage of the batch (${sc.batch.length} messages)\n`);
    W(`**Input messages:**\n`);
    sc.batch.forEach((m, i) => W(`${i + 1}. ${m}`));
    W();
    W(`### ⚠ Signal track — ${signals.length} incident(s) routed to escalation (NOT aggregated)\n`);
    if (!signals.length) W('_none_');
    for (const s of signals) W(`- **${s.signal}** (severity ${s.severity}${s.crisisMatch ? ', crisis-lexicon match' : ''}): ${s.message}`);
    W();
    W(`### Summary by domain (regular feedback)\n`);
    for (const [domain, text] of Object.entries(summaryByDomain)) {
      W(`**${domain}**`);
      W(text);
      W();
    }
    W(`<details><summary>per-message triage labels</summary>\n`);
    W('```');
    labels.forEach((l, i) => W(`${i + 1}. [${l.signal}/${l.severity}] ${l.domain}`));
    W('```');
    W(`</details>`);

    writeFileSync(FILE, out.join('\n') + '\n');
  }
  log('\nwrote results-scenarios-upgraded.md');
})();
