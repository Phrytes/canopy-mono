// Property-layer (charter) wiring — released coarse attributes + charterHash ride the contribution
// and rare attribute-combos are attributeK-suppressed at the aggregation READ (RESEARCH-context only).
// The feedback TEXT still aggregates in full; only the *segmentation* is hidden for rare combos.
//   node --test
//
// Reuses @canopy/attribute-charter (suppressRareAttributes / attributeKDefault) — not reimplemented here.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { aggregateWithThreshold, segmentByAttributes } from '../src/aggregate.js';

const CH = 'charter-abc123';                     // a stand-in charterHash all participants agreed to
const COMMON = { place: 'Utrecht', ageBand: '35-54' };
const RARE = { place: 'Zeist', ageBand: '55+' };

let openMocks = [];
afterEach(async () => { for (const m of openMocks) await m.close(); openMocks = []; delete process.env.FP_LLM_BASEURL; });

// ── Pure segmentation (no LLM) ──────────────────────────────────────────────────
test('segmentByAttributes: rare combo suppressed, common combo kept, charterHash rides through', () => {
  const items = [
    { user: 'p1', attributes: { ...COMMON }, charterHash: CH },
    { user: 'p2', attributes: { ...COMMON }, charterHash: CH },
    { user: 'p3', attributes: { ...COMMON }, charterHash: CH },   // combo held by 3 participants
    { user: 'p4', attributes: { ...RARE }, charterHash: CH },
    { user: 'p5', attributes: { ...RARE }, charterHash: CH },     // combo held by only 2 → below attributeK
  ];
  const seg = segmentByAttributes(items, 3);   // attributeK = 3

  // (a) rare combo → attributes SUPPRESSED (absent, empty map — no marker)
  assert.deepEqual(seg.attributesByUser.p4, {});
  assert.deepEqual(seg.attributesByUser.p5, {});
  // (b) common combo (>= attributeK) → attributes KEPT
  assert.deepEqual(seg.attributesByUser.p1, COMMON);
  assert.deepEqual(seg.attributesByUser.p3, COMMON);
  // only the k-safe combo is exposed as a segment
  assert.equal(seg.segments.length, 1);
  assert.deepEqual(seg.segments[0].combo, COMMON);
  assert.equal(seg.segments[0].userCount, 3);
  // (d) charterHash rides through for EVERYONE, including the suppressed participants
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) assert.equal(seg.charterHashByUser[p], CH);
});

test('segmentByAttributes: counts DISTINCT participants, not contributions', () => {
  // p1 alone holds RARE across three contributions — must NOT reach attributeK on its own.
  const items = [
    { user: 'p1', attributes: { ...RARE }, charterHash: CH },
    { user: 'p1', attributes: { ...RARE }, charterHash: CH },
    { user: 'p1', attributes: { ...RARE }, charterHash: CH },
  ];
  const seg = segmentByAttributes(items, 3);
  assert.deepEqual(seg.attributesByUser.p1, {});   // one participant < attributeK → suppressed
  assert.equal(seg.segments.length, 0);
});

test('segmentByAttributes: back-compat — no participant disclosed → null (nothing added)', () => {
  assert.equal(segmentByAttributes([{ user: 'p1' }, { user: 'p2' }], 5), null);
  assert.equal(segmentByAttributes([{ user: 'p1', attributes: {} }], 5), null);
});

// ── End-to-end through aggregateWithThreshold (real pipeline, mock LLM) ──────────
async function aggregateOverPod(records, opts) {
  const mock = await startMockLlm();
  openMocks.push(mock);
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  for (const r of records) await pod.write(r.user, buildContribution({ id: r.id, text: r.text }, { lang: 'nl', attributes: r.attributes, charterHash: r.charterHash }));
  return aggregateWithThreshold('mock', await pod.forAggregation(), { skipClean: true, kThreshold: 2, ...opts });
}

test('aggregate: rare-combo attributes suppressed while their TEXT still counts', async () => {
  const records = [
    { user: 'p1', id: 'p1:1', text: 'De GGZ wachtlijst is veel te lang', attributes: { ...COMMON }, charterHash: CH },
    { user: 'p2', id: 'p2:1', text: 'GGZ wachtlijst echt veel te lang', attributes: { ...COMMON }, charterHash: CH },
    { user: 'p3', id: 'p3:1', text: 'GGZ wachtlijst blijft te lang', attributes: { ...COMMON }, charterHash: CH },
    { user: 'p4', id: 'p4:1', text: 'De GGZ wachtlijst is echt te lang', attributes: { ...RARE }, charterHash: CH },
    { user: 'p5', id: 'p5:1', text: 'GGZ wachtlijst veel te lang zeg', attributes: { ...RARE }, charterHash: CH },
  ];
  const res = await aggregateOverPod(records, { attributeK: 3 });

  // TEXT still counts — all 5 participants + messages accounted for, and the shared theme survives k=2.
  assert.equal(res.totalMessages, 5);
  assert.equal(res.totalUsers, 5);
  assert.ok(res.statistical.some((s) => s.theme === 'waiting times'), 'the waiting-times theme aggregates');

  // Segmentation is attributeK-suppressed: only the common combo is exposed.
  assert.equal(res.attributeK, 3);
  assert.equal(res.segments.length, 1);
  assert.deepEqual(res.segments[0].combo, COMMON);
  assert.deepEqual(res.attributesByUser.p4, {});          // rare → suppressed
  assert.deepEqual(res.attributesByUser.p1, COMMON);      // common → kept
  assert.equal(res.charterHashByUser.p4, CH);             // charterHash rides through even when suppressed
});

test('aggregate: default attributeK = max(k,5) suppresses a 3-participant combo', async () => {
  const records = [1, 2, 3].map((n) => ({ user: `p${n}`, id: `p${n}:1`, text: 'GGZ wachtlijst te lang', attributes: { ...COMMON }, charterHash: CH }));
  const res = await aggregateOverPod(records);   // no explicit attributeK → default max(2,5)=5
  assert.equal(res.attributeK, 5);
  assert.deepEqual(res.attributesByUser.p1, {}); // 3 < 5 → suppressed
  assert.equal(res.segments.length, 0);
});

test('aggregate: back-compat — no attributes → no segmentation fields, behaviour unchanged', async () => {
  const records = [
    { user: 'p1', id: 'p1:1', text: 'De GGZ wachtlijst is veel te lang' },
    { user: 'p2', id: 'p2:1', text: 'GGZ wachtlijst echt veel te lang' },
  ];
  const res = await aggregateOverPod(records, { attributeK: 3 });
  assert.equal(res.totalMessages, 2);
  assert.equal(res.segments, undefined);
  assert.equal(res.attributeK, undefined);
  assert.equal(res.attributesByUser, undefined);
  assert.equal(res.charterHashByUser, undefined);
});
