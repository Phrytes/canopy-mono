#!/usr/bin/env node
/**
 * run-dataset.js <path-to-json> [k] — run the k-anonymous aggregation pipeline
 * over an arbitrary dataset file (used by the stress-test harness, which
 * generates datasets with agents rather than hand-written fixtures).
 *
 * Input JSON: [{ "user": "w1", "lang": "nl"|"en", "text": "..." }, ...]
 * Writes a markdown report next to this app and prints a compact JSON summary
 * (statistical + signal + dropped) to stdout for an auditor to consume.
 *
 *   node scripts/run-dataset.js /tmp/stress-ds.json 3
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { aggregateWithThreshold } from '../src/aggregate.js';
import { langName } from '../src/config.js';

const path = process.argv[2];
const k = process.argv[3] ? Number(process.argv[3]) : 3;
if (!path) { console.error('usage: run-dataset.js <path.json> [k]'); process.exit(2); }

const model = process.env.SIM_MODEL || 'qwen2.5:7b-instruct';
const items = JSON.parse(readFileSync(path, 'utf8'));

const r = await aggregateWithThreshold(model, items, { kThreshold: k });

// markdown report
const out = [];
const W = (s = '') => out.push(s);
W(`# Stress-test dataset run — k=${r.kThreshold}, language ${langName(r.lang)}`);
W(`\n${r.totalUsers} users · ${r.totalMessages} messages · model ${model}\n`);
W(`## Statistical track (≥ ${r.kThreshold} distinct users)\n`);
for (const t of r.statistical) { W(`### ${t.theme} — ${t.userCount} users (${t.messageCount} msgs)`); W(t.summary); W(); }
W(`## Signal track\n`);
for (const s of r.signals) W(`- **${s.signal}** (${s.severity}, via ${s.via}) — ${s.user}: ${s.text}`);
W(`\n## ⚠ Review queue (sensitive, below threshold — quarantined, NOT deleted)\n`);
for (const q of r.review || []) {
  const why = q.detected && q.detected.length ? ` — ⚠ ${q.detected.join('; ')}` : '';
  W(`- **${q.theme}** (via ${q.via}, ${q.userCount} user)${why}:`);
  for (const m of q.messages) W(`  - ${m.user}${m.flags && m.flags.length ? ` [${m.flags.join(', ')}]` : ''}: ${m.text}`);
}
W(`\n## 📇 Contact-request track (PII-only "contact me" messages — handle per protocol)\n`);
for (const c of r.contact || []) W(`- ${c.user}: ${c.text}`);
W(`\n## 🚫 Rejected (prompt-injection / exfiltration attempts — not feedback)\n`);
for (const c of r.rejected || []) W(`- ${c.user}: ${c.reason}`);
W(`\n## Dropped under threshold (non-sensitive)\n`);
for (const d of r.dropped) W(`- ${d.theme} — ${d.userCount} user(s), ${d.messageCount} msg(s)`);
const outPath = new URL('../results-stress.md', import.meta.url);
writeFileSync(outPath, out.join('\n') + '\n');

// compact JSON for the auditor
console.log(JSON.stringify({
  kThreshold: r.kThreshold, totalUsers: r.totalUsers, totalMessages: r.totalMessages,
  statistical: r.statistical.map(({ theme, userCount, messageCount, summary }) => ({ theme, userCount, messageCount, summary })),
  signals: r.signals,
  review: r.review,
  contact: r.contact,
  rejected: r.rejected,
  dropped: r.dropped,
}, null, 2));
