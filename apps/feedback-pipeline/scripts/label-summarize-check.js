// Compare models on the LABEL + SUMMARIZE tasks (no tool-calling). A fixed set
// with deliberate duplicates + distinct topics, so dedup quality is measurable.
//
//   MODELS="qwen2.5:7b-instruct,mistral:7b-instruct" node scripts/label-summarize-check.js
//
// Ideal: labelling gives ~6 distinct domains; summarizing merges the 3 dup-pairs
// → ~6 bullets, nothing invented, stays NL.

import { labelMessages, canonicalDomain } from '../src/triage.js';
import { summarize } from '../src/pipeline.js';
import { detectLang } from '../src/lang.js';

const MODELS = (process.env.MODELS || 'qwen2.5:7b-instruct,mistral:7b-instruct').split(',');

// cleaned-ish NL messages: 3 GGZ-wait (dup), 2 parking (dup), 2 waste (dup),
// + crisis, UWV, safety singletons. Ideal dedup ≈ 6 bullets.
const MSGS = [
  'De wachtlijst bij de GGZ is al maanden, ik wacht nog steeds op behandeling.',
  'Sta sinds januari op de wachtlijst voor specialistische GGZ-zorg, er gebeurt niks.',
  'Mijn zoon staat al anderhalf jaar op de wachtlijst bij de jeugd-GGZ.',
  'Het betaald parkeren bij de polikliniek is veel te duur geworden.',
  'Parkeren kost hier nu 4 euro per uur, dat is belachelijk.',
  'Sinds het nieuwe afvalschema wordt de bak nog maar 1x per 2 weken geleegd.',
  'De container wordt veel te weinig geleegd sinds het schema veranderde.',
  'Ik kom mijn bed amper uit en heb dagen dat ik niet meer wil.',
  'De keuringsarts bij het UWV heeft mij volgens mij onterecht afgekeurd.',
  'De oversteekplaats bij de school is levensgevaarlijk, er gebeurt nog een ongeluk.',
];

for (const model of MODELS) {
  console.log(`\n══════════ ${model} ══════════`);

  // LABEL
  let labels = [];
  const tL = Date.now();
  try { labels = await labelMessages(model, MSGS, {}); } catch (e) { console.log('  label error:', e.message); }
  const raw = labels.map((l) => l.domain);
  const canon = raw.map(canonicalDomain);
  console.log(`  LABEL [${((Date.now() - tL) / 1000).toFixed(0)}s]`);
  console.log(`    raw domains      : ${JSON.stringify(raw)}`);
  console.log(`    canonical        : ${JSON.stringify(canon)}`);
  console.log(`    distinct (raw→canon): ${new Set(raw).size} → ${new Set(canon).size}  (ideal ~6)`);
  console.log(`    signals          : ${labels.map((l, i) => l.signal !== 'none' ? `#${i}:${l.signal}` : null).filter(Boolean).join(', ') || 'none'}`);

  // SUMMARIZE (whole set, NL)
  const tS = Date.now();
  let s = { text: '' };
  try { s = await summarize(model, MSGS, { lang: 'nl' }); } catch (e) { s = { text: '⚠ ' + e.message }; }
  const bullets = (s.text || '').split('\n').filter((b) => b.trim().startsWith('-') || b.trim().startsWith('•'));
  console.log(`  SUMMARIZE [${((Date.now() - tS) / 1000).toFixed(0)}s] — ${bullets.length} bullets (ideal ~6), lang=${detectLang(s.text).lang}`);
  console.log((s.text || '').split('\n').map((l) => '    ' + l).join('\n'));
}
console.log('');
