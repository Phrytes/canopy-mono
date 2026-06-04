#!/usr/bin/env node
/**
 * trace-doc.js <input.json> <output.json> <title> [out.md]
 *
 * Writes a human-readable Markdown trace from a dataset run: the raw INPUT
 * lines (numbered, per user) followed by the full OUTPUT (every track), so a
 * run can be reviewed end-to-end later. Input is the [{user,lang,text}] dataset;
 * output is the JSON emitted by run-dataset.js.
 *
 *   node scripts/trace-doc.js /tmp/b-ds.json /tmp/b-out2.json "Scenario B (zorg/UWV)" docs/TRACE-scenario-B.md
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath, title, mdPath] = process.argv.slice(2);
if (!inPath || !outPath || !title) { console.error('usage: trace-doc.js <input.json> <output.json> <title> [out.md]'); process.exit(2); }

const input = JSON.parse(readFileSync(inPath, 'utf8'));
const r = JSON.parse(readFileSync(outPath, 'utf8'));
const out = [];
const W = (s = '') => out.push(s);

W(`# Run trace — ${title}`);
W(`\n${r.totalUsers} users · ${r.totalMessages} messages · k=${r.kThreshold} · language ${r.lang}. All synthetic.`);
W(`\nTracks: statistical=${r.statistical.length} · signals=${r.signals.length} · review=${(r.review || []).length} · contact=${(r.contact || []).length} · rejected=${(r.rejected || []).length} · dropped=${r.dropped.length}\n`);

W(`## 0. Raw input (verbatim)\n`);
input.forEach((m, i) => W(`${i + 1}. **${m.user}** (${m.lang}): ${m.text}`));
W();

W(`## 📊 Statistical track (≥ k distinct users, k-anonymous)\n`);
if (!r.statistical.length) W('_none_');
for (const t of r.statistical) { W(`### ${t.theme} — ${t.userCount} users (${t.messageCount} msgs)`); W(t.summary); W(); }

W(`## 🚨 Signal track (escalated incidents)\n`);
if (!r.signals.length) W('_none_');
for (const s of r.signals) W(`- **${s.signal}** (${s.severity}, via ${s.via}) — ${s.user}: ${s.text}`);
W();

W(`## 🔎 Review queue (sensitive, below threshold — quarantined)\n`);
if (!(r.review || []).length) W('_none_');
for (const q of r.review || []) {
  W(`- **${q.theme}** (via ${q.via}${q.detected && q.detected.length ? ', ⚠ ' + q.detected.join('; ') : ''}, ${q.userCount} user):`);
  for (const m of q.messages) W(`  - ${m.user}${m.flags && m.flags.length ? ` [${m.flags.join(', ')}]` : ''}: ${m.text}`);
}
W();

W(`## 📇 Contact-request track (PII-only "contact me")\n`);
if (!(r.contact || []).length) W('_none_');
for (const c of r.contact || []) W(`- ${c.user}: ${c.text}`);
W();

W(`## 🚫 Rejected (prompt-injection / de-anonymisation attempts — not feedback)\n`);
if (!(r.rejected || []).length) W('_none_');
for (const c of r.rejected || []) W(`- ${c.user}: ${c.reason}`);
W();

W(`## 🗑️ Dropped (non-sensitive, below threshold)\n`);
if (!r.dropped.length) W('_none_');
for (const d of r.dropped) W(`- ${d.theme} — ${d.userCount} user(s), ${d.messageCount} msg(s)`);

const dest = mdPath || `docs/TRACE-${title.replace(/[^a-z0-9]+/gi, '-')}.md`;
writeFileSync(new URL('../' + dest, import.meta.url), out.join('\n') + '\n');
console.log('wrote ' + dest);
