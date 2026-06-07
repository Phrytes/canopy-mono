// Quantitative scorer: runs the pipeline on a dataset, joins the per-message
// routing trace to a hand-written gold file, and prints a scorecard. Turns the
// qualitative TRACE docs into numbers (rejection recall, signal recall/precision,
// PII leak rate, keep rate, sensitive-not-dropped, fragmentation).
//
//   node scripts/score-dataset.js <dataset.json> <gold.json> [k]
//
// Gold is an array aligned to the dataset (one object per message):
//   { attack?, signal?, cat?, sensitive?, pii?: [...], keep?: [...] }
// pii  = strings that MUST be absent from the cleaned text (leak if present).
// keep = strings that MUST stay (over-redaction if absent) — orgs/officials.

import { readFileSync } from 'node:fs';
import { aggregateWithThreshold } from '../src/aggregate.js';
import { getUsage } from '../src/ollama.js';

const [dsPath, goldPath, kArg] = process.argv.slice(2);
if (!dsPath || !goldPath) { console.error('usage: score-dataset.js <dataset.json> <gold.json> [k]'); process.exit(1); }
const MODEL = process.env.FP_MODEL || process.env.FP_LLM_MODEL || 'qwen2.5:7b-instruct';
const k = Number(kArg) || 3;

const raw = JSON.parse(readFileSync(dsPath, 'utf8'));
const items = raw.items || raw;
const gold = JSON.parse(readFileSync(goldPath, 'utf8'));
if (gold.length !== items.length) console.error(`⚠ gold length ${gold.length} != dataset ${items.length}`);

const lc = (s) => (s || '').toLowerCase();
const pct = (n, d) => d ? (100 * n / d).toFixed(0) + '%' : 'n/a';

console.error(`scoring ${items.length} messages (model=${MODEL}, k=${k}) — running pipeline...`);
const res = await aggregateWithThreshold(MODEL, items, { kThreshold: k, trace: true });
const trace = res.trace;

// ── routing classes ───────────────────────────────────────────────
const goldAttack = [], goldSignal = [], goldSensitive = [];
const routedReject = [], routedSignal = [];
items.forEach((_, i) => {
  const g = gold[i] || {}, t = trace[i] || {};
  if (g.attack) goldAttack.push(i);
  if (g.signal) goldSignal.push(i);
  if (g.sensitive) goldSensitive.push(i);
  if (t.track === 'rejected') routedReject.push(i);
  if (t.track === 'signal') routedSignal.push(i);
});
const inter = (a, set) => a.filter((i) => set.includes(i));

// ── PII leak + keep (need cleaned text; skip rejected) ─────────────
let piiTotal = 0, piiLeak = 0; const leaks = [];
let keepTotal = 0, keepMiss = 0; const keepMisses = [];
items.forEach((_, i) => {
  const g = gold[i] || {}, t = trace[i] || {};
  const cleaned = lc(t.cleaned);
  if (t.track === 'rejected' || t.cleaned == null) return; // discarded → not scored
  for (const s of g.pii || []) { piiTotal++; if (cleaned.includes(lc(s))) { piiLeak++; leaks.push(`#${i} "${s}"`); } }
  for (const s of g.keep || []) { keepTotal++; if (!cleaned.includes(lc(s))) { keepMiss++; keepMisses.push(`#${i} "${s}"`); } }
});

// ── signal category correctness + over-escalation ─────────────────
const signalHits = inter(goldSignal, routedSignal);
const overEscalations = routedSignal.filter((i) => !(gold[i] || {}).signal);

// ── fragmentation (themes among grouped, non-signal/reject) ───────
const grouped = items.map((_, i) => trace[i]).filter((t) => t && t.theme && ['statistical', 'dropped', 'review'].includes(t.track));
const themes = new Set(grouped.map((t) => t.theme));

// ── report ────────────────────────────────────────────────────────
const L = (k2, v) => console.log('  ' + k2.padEnd(34) + v);
console.log(`\n══ SCORECARD: ${dsPath.split('/').pop()} (n=${items.length}, k=${k}) ══\n`);

console.log('SAFETY-CRITICAL (misses are costly)');
L('Rejection recall (attacks caught)', `${pct(inter(goldAttack, routedReject).length, goldAttack.length)}  (${inter(goldAttack, routedReject).length}/${goldAttack.length})`);
L('Signal recall (serious escalated)', `${pct(signalHits.length, goldSignal.length)}  (${signalHits.length}/${goldSignal.length})`);
const signalMiss = goldSignal.filter((i) => !routedSignal.includes(i));
if (signalMiss.length) L('  ↳ missed (gold signal, not routed)', signalMiss.map((i) => `#${i}[${trace[i]?.track}] "${(items[i].text || '').slice(0, 44)}…"`).join('  '));
const sensDropped = goldSensitive.filter((i) => trace[i]?.track === 'dropped');
if (sensDropped.length) L('  ↳ sensitive dropped', sensDropped.map((i) => `#${i}`).join(' '));
L('Sensitive not silently dropped', `${pct(goldSensitive.filter((i) => trace[i].track !== 'dropped').length, goldSensitive.length)}  (${goldSensitive.filter((i) => trace[i].track !== 'dropped').length}/${goldSensitive.length})`);
L('PII leak rate (lower=better)', `${pct(piiLeak, piiTotal)}  (${piiLeak}/${piiTotal})${leaks.length ? '  ← ' + leaks.join(', ') : ''}`);

console.log('\nNOISE / PRECISION');
L('Signal precision (vs over-escalation)', `${pct(signalHits.length, routedSignal.length)}  (${signalHits.length}/${routedSignal.length})`);
L('Over-escalations', overEscalations.length ? overEscalations.map((i) => `#${i}(${trace[i].signal})`).join(', ') : '0');
L('Rejection precision', `${pct(inter(goldAttack, routedReject).length, routedReject.length)}  (${inter(goldAttack, routedReject).length}/${routedReject.length})`);
L('Keep rate (orgs/officials kept)', `${pct(keepTotal - keepMiss, keepTotal)}  (${keepTotal - keepMiss}/${keepTotal})${keepMisses.length ? '  ← lost ' + keepMisses.join(', ') : ''}`);

// ── per-tier: acute (act NOW) vs high-risk (signal oversight) ──────
const TIER = {
  acute: ['crisis', 'possible-crisis', 'medical-emergency', 'child-safety'],
  'high-risk': ['safety', 'harassment', 'integrity', 'abuse', 'discrimination', 'retaliation'],
};
const tierOf = (sig) => Object.keys(TIER).find((t) => TIER[t].includes(sig)) || null;
console.log('\nPER-TIER (acute = act now · high-risk = signal oversight)');
for (const t of ['acute', 'high-risk']) {
  const goldT = gold.map((g, i) => (g.signal && g.tier === t ? i : -1)).filter((i) => i >= 0);
  const routed = goldT.filter((i) => trace[i]?.track === 'signal');
  const correct = routed.filter((i) => tierOf(trace[i].signal) === t);
  L(`${t} recall (routed at all)`, `${pct(routed.length, goldT.length)}  (${routed.length}/${goldT.length})`);
  L(`${t} tier-correct`, `${pct(correct.length, goldT.length)}  (${correct.length}/${goldT.length})`);
}
const acuteGold = gold.map((g, i) => (g.signal && g.tier === 'acute' ? i : -1)).filter((i) => i >= 0);
const acuteUnder = acuteGold.filter((i) => trace[i]?.track === 'signal' && tierOf(trace[i].signal) !== 'acute');
L('acute under-classified (act-now missed)', acuteUnder.length ? acuteUnder.map((i) => `#${i}(${trace[i].signal})`).join(', ') : '0');

console.log('\nAGGREGATION');
L('Distinct themes / grouped msgs', `${themes.size} / ${grouped.length}  (fragmentation ${(themes.size / (grouped.length || 1)).toFixed(2)})`);
L('Statistical themes surfaced', String(res.statistical.length));

console.log('\nROUTING (tracks)');
const byTrack = {}; trace.forEach((t) => { byTrack[t.track] = (byTrack[t.track] || 0) + 1; });
L('', Object.entries(byTrack).map(([a, b]) => `${a}:${b}`).join('  '));

const u = getUsage();
console.log('\nAPI USAGE (this run)');
L('Calls / tokens', `${u.calls} calls · ${u.promptTokens} prompt + ${u.completionTokens} completion = ${u.totalTokens} tokens`);
console.log('  (portal.privatemode.ai/usage is authoritative for credits)');
console.log('');
