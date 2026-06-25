#!/usr/bin/env node
// Headless e2e for the verify-summary loop (docs/DESIGN-verify-summary-loop.md) — the FULL Slice-1 flow:
//   contribute (OWN pod) → LEAD opens a round → bot POLL opens the verify-turn → summarise ON-DEVICE
//   (LLM via the loopback proxy) → user VERIFIES → ONLY the verified summary on CENTRAL; raw stays own;
//   a re-poll after verify does not re-ask.
//
//   FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_MODEL=gpt-oss-latest node scripts/verify-summary-smoke.js
//
// Skips cleanly (exit 0) if the summarise LLM route is unreachable.
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import * as signing from '../src/pod/signing.js';
import { buildContribution } from '../src/pod/contribution.js';
import { InMemoryRoundControl, openVerificationRound, pollAndOpenVerification } from '../src/verify/round-control.js';

const log = (...a) => console.log(...a);
const lastVerifyBubble = (sent) => [...sent].reverse().find((m) => m.type === 'verify-summary');

const id = signing.generateParticipantIdentity();
const roster = new signing.IdentityRoster();
roster.bind('alice', id.publicKey, id.encPublicKey);
const verify = signing.makeContributionVerifier({ roster, projectId: 'demo' });
const ownPod = new InMemoryCentralPod({ verify });
const central = new InMemoryCentralPod({ verify });
const adapter = new MemoryChannelAdapter();
const config = validateProjectConfig({
  projectId: 'demo', llm: { route: 'local', model: process.env.FP_LLM_MODEL || 'gpt-oss-latest' },
  aggregation: { k: 1 }, privacy: { verify: true },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});
const d = new ChannelDispatcher({ adapter, pod: ownPod, config, participant: 'alice', identity: id, centralPod: central });
const control = new InMemoryRoundControl();

// ── Stage 1 — alice's RAW feedback → her OWN pod (signed). It never leaves. ─────────────────────────
const raw = ['De GGZ-wachtlijst is al maanden veel te lang.', 'En de communicatie erover is ook slecht.'];
for (const [i, text] of raw.entries()) {
  const c = buildContribution({ id: `alice:p${i + 1}`, text }, { lang: 'nl' });
  await ownPod.write('alice', c, signing.contributionMeta(id, { projectId: 'demo', participant: 'alice', contribution: c }));
}
log(`Stage 1 — own pod holds ${ownPod.list().length} raw point(s).`);

// ── Stage 2 — the LEAD opens a verification round (writes a request to the control store). ──────────
await openVerificationRound({ controlStore: control, projectId: 'demo', round: 1, openedBy: 'lead', message: 'Verifieer je samenvatting.' });
log('Lead opened verification round 1.');

// ── the bot POLLS (as on contact-open) → opens the verify-turn → summarises ON-DEVICE via the proxy. ─
const opened = await pollAndOpenVerification({ dispatcher: d, controlStore: control, projectId: 'demo', participant: 'alice', centralPod: central });
if (!opened) { log('SKIP: no round opened.'); process.exit(0); }
const presented = lastVerifyBubble(adapter.sent);
if (!presented || !presented.summary) { log('SKIP: summarise produced no summary (LLM route unreachable?).'); process.exit(0); }
log(`\nBot poll → on-device summary (via the confidential proxy):\n  "${presented.summary}"`);

// ── alice VERIFIES → ONLY the verified summary is sealed+signed to central. ─────────────────────────
const cid = await d.command('verify');
log(`\nalice verified → ${cid} released to central.`);

// ── Assertions ──────────────────────────────────────────────────────────────────────────────────────
const onlyVerified = central.list().length === 1 && (central.list()[0].contribution.themeTags || []).includes('verified-summary');
const rawStayed = ownPod.list().length === raw.length && central.list().every((r) => !raw.includes(r.contribution.text));
const noReask = (await pollAndOpenVerification({ dispatcher: d, controlStore: control, projectId: 'demo', participant: 'alice', centralPod: central })) === null;

log('\n=== RESULT ===');
log(`  central: ${central.list().length} record [${(central.list()[0]?.contribution.themeTags) || []}] · own pod raw: ${ownPod.list().length} · re-ask after verify: ${noReask ? 'no' : 'YES (bug)'}`);
const ok = onlyVerified && rawStayed && noReask;
log(ok
  ? '\n✓ full verify-summary loop: lead-triggered · on-device summary · user-verified · raw stayed own · no re-ask.'
  : '\n✗ FAIL — an invariant broke.');
process.exit(ok ? 0 : 1);
