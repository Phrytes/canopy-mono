// Geo/profanity prompt tuning — A/B harness (2026-07-16).
//
// Runs a set of geo + profanity fixtures (NL + EN) through the CLEAN pass twice —
// BASELINE (the wired MINIMAL_CLEAN) vs CANDIDATE (MINIMAL_CLEAN_CANDIDATE, the
// geo-coarsening / profanity-preserving draft) — and prints them side by side with
// heuristic checks, so you can judge on REAL model output before adopting the draft.
// Nothing in the pipeline changes; the candidate is injected via opts.cleanSystem.
//
// Run against the standard privatemode route (defaults to the loopback proxy):
//   FP_MODEL=gpt-oss-120b node scripts/prompt-tuning-geo-profanity.js
// or point at any deployment:
//   FP_LLM_BASEURL=http://localhost:8080/v1 FP_MODEL=gpt-oss-120b node scripts/prompt-tuning-geo-profanity.js
//
// Heuristics (aids, not gospel — eyeball the text too):
//   • geo-coarsen: the fine location (street+number/postcode) is GONE from the output
//   • geo-keep:    the coarse/public place (municipality, "gemeentehuis") is still there
//   • profanity:   hasProfanity(output) === false (reuses the deterministic floor)
//   • point-kept:  the substantive content word(s) survived (the criticism wasn't lost)
import { cleanMessage } from '../src/pipeline.js';
import { MINIMAL_CLEAN_CANDIDATE } from '../src/prompt-profiles.js';
import { applyLlmRoute } from '../src/ollama.js';
import { hasProfanity } from '../src/decurse.js';

// Route: honour FP_LLM_BASEURL if set (ollama reads it directly), else install the
// privatemode loopback proxy (http://localhost:8080/v1) — the standard route.
if (!process.env.FP_LLM_BASEURL) {
  try { applyLlmRoute({ route: 'privatemode' }); } catch (e) { console.warn('[route]', e.message); }
}
const MODEL = process.env.FP_MODEL || 'gpt-oss-120b';

// fixtures: raw + what SHOULD happen. lang defaults to 'nl'.
const FIX = [
  { raw: 'De herrie uit de Kerkstraat 12 houdt de hele buurt \'s nachts wakker.',
    dropGeo: ['Kerkstraat 12'], keepWords: ['herrie', 'wakker'] },
  { raw: 'Mijn buurman op 9712 CP nummer 8 dumpt al weken afval in de gracht.',
    dropGeo: ['9712 CP', 'nummer 8'], keepWords: ['afval'] },
  { raw: 'Het gemeentehuis in Groningen is telefonisch nooit bereikbaar over mijn uitkering.',
    keepGeo: ['gemeentehuis', 'Groningen'], keepWords: ['bereikbaar', 'uitkering'] },
  { raw: 'De wethouder is een sukkel, hij negeert alle klachten over de wachtlijst.',
    expectProfanityGone: true, keepWords: ['klachten', 'wachtlijst'] },
  { raw: 'Het is belachelijk dat de wachtlijst bij de GGZ al maanden zo lang is.',
    keepWords: ['belachelijk', 'wachtlijst'] },   // "belachelijk" = about the SITUATION → should stay
  { raw: 'That idiot at 45 Main Street keeps blocking the bins every single week.', lang: 'en',
    dropGeo: ['45 Main Street'], expectProfanityGone: true, keepWords: ['blocking', 'bins'] },
  { raw: 'The town hall in Rotterdam never answers the phone about my benefits.', lang: 'en',
    keepGeo: ['town hall', 'Rotterdam'], keepWords: ['benefits'] },
];

const has = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
const mark = (ok) => (ok ? '✓' : '✗');

// Score one cleaned output against a fixture's expectations. Returns {line, pass}.
function score(f, out) {
  const checks = [];
  for (const g of f.dropGeo || []) checks.push([`geo-coarsen(${g})`, !has(out, g)]);
  for (const g of f.keepGeo || []) checks.push([`geo-keep(${g})`, has(out, g)]);
  if (f.expectProfanityGone) checks.push(['profanity-gone', !hasProfanity(out)]);
  for (const w of f.keepWords || []) checks.push([`point-kept(${w})`, has(out, w)]);
  const pass = checks.filter(([, ok]) => ok).length;
  return { line: checks.map(([n, ok]) => `${mark(ok)} ${n}`).join('  '), pass, tot: checks.length };
}

const tally = { baseline: { pass: 0, tot: 0 }, candidate: { pass: 0, tot: 0 } };

console.log(`\n══════ geo/profanity A/B — model: ${MODEL} ${process.env.FP_LLM_BASEURL ? `(${process.env.FP_LLM_BASEURL})` : '(privatemode loopback)'} ══════`);
for (const f of FIX) {
  const lang = f.lang || 'nl';
  const base = await cleanMessage(MODEL, f.raw, { userLang: lang });
  const cand = await cleanMessage(MODEL, f.raw, { userLang: lang, cleanSystem: MINIMAL_CLEAN_CANDIDATE[lang] });
  const bs = score(f, base.cleaned || '');
  const cs = score(f, cand.cleaned || '');
  tally.baseline.pass += bs.pass; tally.baseline.tot += bs.tot;
  tally.candidate.pass += cs.pass; tally.candidate.tot += cs.tot;
  console.log(`\n[${lang}] RAW:       ${f.raw}`);
  console.log(`      BASELINE:  ${base.cleaned ?? `⚠ ${base.error}`}`);
  console.log(`                 ${bs.line}   (${bs.pass}/${bs.tot})`);
  console.log(`      CANDIDATE: ${cand.cleaned ?? `⚠ ${cand.error}`}`);
  console.log(`                 ${cs.line}   (${cs.pass}/${cs.tot})`);
}
console.log(`\n────── heuristic totals ──────`);
console.log(`  baseline : ${tally.baseline.pass}/${tally.baseline.tot}`);
console.log(`  candidate: ${tally.candidate.pass}/${tally.candidate.tot}`);
console.log('\nHeuristics are a guide — read the text: the goal is fine addresses coarsened, public places kept,');
console.log('insults gone WITH the point preserved, and situation-words ("belachelijk") NOT over-sanitised.\n');
