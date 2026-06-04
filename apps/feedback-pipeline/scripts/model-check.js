// Quick model comparison for the Dutch CLEAN + LABEL tasks (no tool-calling,
// so the household tool-call failures of geitje/mistral don't apply here).
//
//   MODELS="qwen2.5:7b-instruct,bramvanroy/geitje-7b-ultra:Q4_K_M,mistral:7b-instruct" \
//   node scripts/model-check.js
//
// Discriminating checks (the deterministic floors are model-independent, so we
// test what the LLM actually adds):
//   • leftover NAME removal — bare surnames / foreign names the gazetteer misses
//     (only the LLM identifier pass can catch these)
//   • SEVERITY words kept verbatim (no softening)
//   • [tokens] preserved, language stays NL, no wild drift (hallucination)
//   • LABEL: valid JSON + how many DISTINCT domains (vs collapsing to "general")

import { cleanMessage } from '../src/pipeline.js';
import { labelMessages } from '../src/triage.js';
import { detectLang } from '../src/lang.js';
import { hasProfanity } from '../src/decurse.js';

const MODELS = (process.env.MODELS || 'qwen2.5:7b-instruct,bramvanroy/geitje-7b-ultra:Q4_K_M,mistral:7b-instruct').split(',');

// raw NL fixtures with model-discriminating elements
const FIX = [
  { raw: 'Die hufter van een Jansen blokkeert al weken de containers, bel hem op 06-12345678.',
    removeNames: ['Jansen'], keepWords: [] },
  { raw: 'Ik kom mijn bed amper uit en heb dagen dat ik niet meer wil. De wachtlijst bij de GGZ is al maanden.',
    removeNames: [], keepWords: [] },
  { raw: 'De oversteekplaats bij de school is levensgevaarlijk, er gebeurt nog een dodelijk ongeluk.',
    removeNames: [], keepWords: ['levensgevaarlijk', 'dodelijk'] },
  { raw: 'Vraag even aan Mehmet of hij de sleutel teruggeeft, ik was echt doodsbang vannacht.',
    removeNames: ['Mehmet'], keepWords: ['doodsbang'] },
  { raw: 'Het UWV behandelt me als een fraudeur, klote situatie, ik weet niet meer wat ik moet.',
    removeNames: [], keepWords: ['fraudeur'] },
];

const has = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());
const tokens = (s) => (s.match(/\[[^\]]+\]/g) || []).length;

for (const model of MODELS) {
  console.log(`\n══════════ ${model} ══════════`);
  const cleanedSet = [];
  let nameOK = 0, nameTot = 0, sevOK = 0, sevTot = 0, tokOK = 0, langOK = 0, profOK = 0;
  for (const f of FIX) {
    const t0 = Date.now();
    const c = await cleanMessage(model, f.raw, {});
    const out = c.cleaned ?? `⚠ ${c.error}`;
    cleanedSet.push(out);
    const inTok = tokens(f.raw.replace(/06-?\d{8}/g, '[telefoonnummer]'));
    for (const n of f.removeNames) { nameTot++; if (!has(out, n)) nameOK++; }
    for (const w of f.keepWords) { sevTot++; if (has(out, w)) sevOK++; }
    if (tokens(out) >= inTok) tokOK++;
    if (detectLang(out).lang !== 'en') langOK++;            // stayed NL (or no EN drift)
    if (!hasProfanity(out)) profOK++;
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${out}`);
  }
  // label the cleaned set
  let labelInfo = 'label: (failed)';
  try {
    const labels = await labelMessages(model, cleanedSet, {});
    const domains = labels.map((l) => l.domain);
    const distinct = new Set(domains).size;
    const blank = domains.filter((d) => !d || d === 'general').length;
    labelInfo = `label: ${distinct} distinct domains, ${blank} generic/blank — ${JSON.stringify(domains)}`;
  } catch (e) { labelInfo = 'label error: ' + e.message; }

  console.log(`  ── scores ──`);
  console.log(`  leftover-name removed : ${nameOK}/${nameTot}`);
  console.log(`  severity kept         : ${sevOK}/${sevTot}`);
  console.log(`  tokens preserved      : ${tokOK}/${FIX.length}`);
  console.log(`  stayed NL (no drift)  : ${langOK}/${FIX.length}`);
  console.log(`  profanity gone        : ${profOK}/${FIX.length}`);
  console.log(`  ${labelInfo}`);
}
console.log('');
