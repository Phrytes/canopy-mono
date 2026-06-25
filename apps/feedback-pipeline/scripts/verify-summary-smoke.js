#!/usr/bin/env node
// Headless smoke for the verify-summary loop (docs/DESIGN-verify-summary-loop.md), Build Slice 1 core.
//   contribute (OWN pod) → lead opens round → summarise ON-DEVICE → user verifies → verified summary
//   on the CENTRAL pod, while the RAW stays in the own pod.
//
//   FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_MODEL=gpt-oss-latest node scripts/verify-summary-smoke.js
//
// Skips cleanly (exit 0) if no LLM route is reachable — the summarise step needs one.
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import * as signing from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';
import { summariseOwnContributions, releaseVerifiedSummary } from '../src/verify/summary-round.js';

const log = (...a) => console.log(...a);

const id = signing.generateParticipantIdentity();
const roster = new signing.IdentityRoster();
roster.bind('alice', id.publicKey, id.encPublicKey);
const verify = signing.makeContributionVerifier({ roster, projectId: 'demo' });

// ── Stage 1 — alice's RAW feedback lives in HER OWN pod (signed). It never leaves. ──────────────────
const ownPod = new InMemoryCentralPod({ verify });
const raw = ['De GGZ-wachtlijst is al maanden veel te lang.', 'En de communicatie erover is ook slecht.'];
for (const [i, text] of raw.entries()) {
  const c = buildContribution({ id: `alice:p${i + 1}`, text }, { lang: 'nl' });
  await ownPod.write('alice', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'alice', contribution: c }));
}
log(`Stage 1 — own pod holds ${ownPod.list().length} raw point(s).`);

// ── The CENTRAL pod — must hold ONLY a verified summary at the end. ─────────────────────────────────
const central = new InMemoryCentralPod({ verify });

// ── Stage 2 — lead opens round → alice's bot summarises HER OWN pod on-device → she verifies → release.
const model = process.env.FP_LLM_MODEL || 'gpt-oss-latest';
let draft;
try {
  draft = await summariseOwnContributions({ ownPod, participant: 'alice', model, projectId: 'demo', round: 1, opts: { lang: 'nl' } });
} catch (e) { log(`SKIP: summarise needs an LLM route (set FP_LLM_BASEURL). (${e.message})`); process.exit(0); }
if (!draft.summary) { log('SKIP: summary empty — LLM route unreachable.'); process.exit(0); }
log(`\nStage 2 — on-device summary draft (via the confidential proxy):\n  "${draft.summary}"`);

// alice VERIFIES → the verified summary (and ONLY that) is sealed+signed to central.
const cid = await releaseVerifiedSummary({ centralPod: central, draft, identity: id, participant: 'alice', lang: 'nl' });
log(`\nalice verified → released ${cid} to central.`);

// ── Assertions ──────────────────────────────────────────────────────────────────────────────────────
const ownAfter = ownPod.list();
const centralAfter = central.list();
const onlyVerifiedSummary = centralAfter.length === 1 && (centralAfter[0].contribution.themeTags || []).includes('verified-summary');
const rawNeverLeft = ownAfter.length === raw.length && centralAfter.every((r) => !raw.includes(r.contribution.text));

log('\n=== RESULT ===');
log(`  central pod: ${centralAfter.length} record(s) — tags ${JSON.stringify((centralAfter[0]?.contribution.themeTags) || [])}`);
log(`  own pod still holds the raw: ${ownAfter.length} point(s)`);
const ok = onlyVerifiedSummary && rawNeverLeft;
log(ok
  ? '\n✓ verify-summary loop: raw stayed in the own pod; ONLY the user-verified summary reached central.'
  : '\n✗ FAIL — invariant broken (raw leaked to central, or no verified summary).');
process.exit(ok ? 0 : 1);
