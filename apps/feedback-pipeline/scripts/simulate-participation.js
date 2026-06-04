#!/usr/bin/env node
/**
 * simulate-participation.js — simulate the 6-step feedback pipeline
 * (commerciele_verkenning.md) for ONE scenario: Richting 5 citizen
 * participation, with MULTIPLE people giving different feedback.
 *
 * Steps modelled: 2 (raw intake) → 3 (clean per message) → 4 (co-redactie,
 * AUTO-APPROVED — the user agrees) → 5 (aggregation with a k-anonymity
 * threshold) → 6 (statistical + signal tracks only; no full curation report).
 *
 * Writes ./results-participation.md.
 *
 *   node scripts/simulate-participation.js
 *   FP_K=4 FP_LANG=nl node scripts/simulate-participation.js
 */
import { writeFileSync } from 'node:fs';
import { PARTICIPATION } from '../fixtures/participation.js';
import { aggregateWithThreshold } from '../src/aggregate.js';
import { langName } from '../src/config.js';
import { OLLAMA_BASE } from '../src/ollama.js';

const MODEL = process.env.SIM_MODEL || 'qwen2.5:7b-instruct';
const K = process.env.FP_K ? Number(process.env.FP_K) : PARTICIPATION.kDefault;
const log = (s) => process.stderr.write(s + '\n');

(async () => {
  log(`simulate participation: ${PARTICIPATION.messages.length} messages, k=${K}, model ${MODEL} …`);
  const r = await aggregateWithThreshold(MODEL, PARTICIPATION.messages, { kThreshold: K });

  const out = [];
  const W = (s = '') => out.push(s);
  W(`# Simulatie — Burgerparticipatie (Richting 5), feedback-pipeline`);
  W(`\n**Onderwerp:** ${PARTICIPATION.topic}`);
  W(`\nModel ${MODEL}, taal **${langName(r.lang)}**, Ollama @ ${OLLAMA_BASE}. Synthetisch.`);
  W(`\nPipeline: stap 2 (inname) → 3 (lokale filtering) → 4 (co-redactie: AUTO-GOEDGEKEURD, gebruiker akkoord) → 5 (aggregatie met k-drempel) → 6 (statistisch + signaal spoor).`);
  W(`\n**Deelnemers:** ${r.totalUsers} · **berichten:** ${r.totalMessages} · **k-drempel:** ${r.kThreshold} (een thema verschijnt pas vanaf ${r.kThreshold} verschillende deelnemers).\n`);

  W(`## 📊 Statistisch spoor (k-anoniem — alleen thema's van ≥ ${r.kThreshold} deelnemers)\n`);
  if (!r.statistical.length) W("_geen thema's boven de drempel_");
  for (const t of r.statistical) {
    W(`### ${t.theme}  — ${t.userCount} deelnemers (${t.messageCount} berichten)`);
    W(t.summary);
    W();
  }

  W(`## 🚨 Signaal spoor (geen drempel — één melding is genoeg)\n`);
  if (!r.signals.length) W('_geen signalen_');
  for (const s of r.signals) {
    W(`- **${s.signal}** (ernst ${s.severity}, via ${s.via}) — deelnemer ${s.user}: ${s.text}`);
  }
  W();

  W(`## 🔎 Review-wachtrij (gevoelig, onder de drempel — NIET verwijderd, naar menselijke beoordeling)\n`);
  if (!r.review || !r.review.length) W('_geen_');
  for (const q of r.review || []) {
    const why = q.detected && q.detected.length ? ` — ⚠ ${q.detected.join('; ')}` : '';
    W(`- **${q.theme}** (via ${q.via}, ${q.userCount} deelnemer)${why}:`);
    for (const m of q.messages) W(`  - ${m.user}${m.flags && m.flags.length ? ` [${m.flags.join(', ')}]` : ''}: ${m.text}`);
  }
  W();
  if (r.contact && r.contact.length) {
    W(`## 📇 Contact-verzoeken (alleen contactgegevens — afhandelen volgens protocol)\n`);
    for (const c of r.contact) W(`- ${c.user}: ${c.text}`);
    W();
  }

  W(`## 🗑️ Onder de k-drempel weggegooid (niet-gevoelig, transparantie)\n`);
  if (!r.dropped.length) W('_geen_');
  for (const d of r.dropped) W(`- ${d.theme} — ${d.userCount} deelnemer(s), ${d.messageCount} bericht(en) → verwijderd`);

  writeFileSync(new URL('../results-participation.md', import.meta.url), out.join('\n') + '\n');
  log('wrote results-participation.md');
})();
