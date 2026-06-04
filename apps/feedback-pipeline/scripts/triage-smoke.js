#!/usr/bin/env node
/**
 * triage-smoke.js — run the triage-then-summarize flow over TRIAGE_BATCH:
 * pull serious signals out, then summarize the rest per domain.
 *
 * Writes ./results-triage.md.
 *
 *   node scripts/triage-smoke.js
 *   TRIAGE_MODEL=qwen2.5:7b-instruct node scripts/triage-smoke.js
 */
import { writeFileSync } from 'node:fs';
import { TRIAGE_BATCH } from '../fixtures/messages.js';
import { triageSummarize } from '../src/triage.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const MODEL = process.env.TRIAGE_MODEL || 'qwen2.5:7b-instruct';
const log = (s) => process.stderr.write(s + '\n');

(async () => {
  log(`triage ${MODEL} over ${TRIAGE_BATCH.length} messages …`);
  const { signals, summaryByDomain, labels } = await triageSummarize(MODEL, TRIAGE_BATCH);

  const out = [];
  out.push(`# Triage-then-summarize — ${MODEL} @ ${OLLAMA_BASE}\n`);
  out.push(`Input batch (${TRIAGE_BATCH.length} messages):\n`);
  out.push('```');
  TRIAGE_BATCH.forEach((m, i) => out.push(`${i + 1}. ${m}`));
  out.push('```');

  out.push(`\n## ⚠ Signal track — ${signals.length} incident(s) routed to escalation (NOT aggregated)\n`);
  if (!signals.length) out.push('_none_');
  for (const s of signals) {
    out.push(`- **${s.signal}** (severity ${s.severity}${s.crisisMatch ? ', crisis-lexicon match' : ''}): ${s.message}`);
  }

  out.push(`\n## Summary by domain (regular feedback)\n`);
  for (const [domain, text] of Object.entries(summaryByDomain)) {
    out.push(`**${domain}**`);
    out.push(text);
    out.push('');
  }

  out.push(`\n## Per-message labels\n`);
  out.push('```');
  labels.forEach((l, i) => out.push(`${i + 1}. [${l.signal}/${l.severity}] ${l.domain}`));
  out.push('```');

  writeFileSync(new URL('../results-triage.md', import.meta.url), out.join('\n') + '\n');
  log('wrote results-triage.md');
})();
