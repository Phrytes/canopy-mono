// @vitest-environment node
// Integration test for hosting the feedback bot inside canopy-chat (M1.4 + M2). Proves the
// surface co-hosts the bot on a real InternalBus, drives the journey to the pod, SIGNS consent
// with the participant's identity (accepted by a verify pod), passes buttons through + handles
// taps, and parses a project-invite link. The bot OWNS the route (config.llm), no setLlmRoute.

import { test, expect, beforeAll, afterAll } from 'vitest';
import { startMockLlm } from '../../../feedback-pipeline/test/helpers/mock-llm.js';
import { InMemoryCentralPod } from '../../../feedback-pipeline/src/pod/central-pod.js';
import { randomBytes } from 'node:crypto';
import { InternalBus, AgentIdentity } from '@canopy/core';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../../../feedback-pipeline/src/pod/signing.js';
import { createFeedbackSurface, parseFeedbackInvite, feedbackContactItem, signerForIdentity, chunkBubble } from '../../src/feedback/feedbackSurface.js';

let mock;
beforeAll(async () => { mock = await startMockLlm(); });
afterAll(async () => { await mock.close(); });

const cfg = (extra = {}) => ({
  projectId: 'canopy-chat', llm: { route: 'local', model: 'mock', baseURL: mock.url }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] }, ...extra,
});

function setup(opts = {}) {
  const replies = [];
  const pod = opts.pod || new InMemoryCentralPod();
  const surface = createFeedbackSurface({ config: cfg(opts.configExtra), pod, emit: (r) => replies.push(r), ...opts.surface });
  return { surface, pod, replies };
}

test('free text is ignored until /feedback, then routed to the bot', async () => {
  const { surface, replies } = setup();
  expect(await surface.handle('De GGZ wachtlijst is te lang', 't1')).toBe(false);
  await surface.start('t1');
  expect(replies.at(-1).text).toMatch(/Zo werkt het/);
  replies.length = 0;
  expect(await surface.handle('De wachtlijst bij de GGZ is veel te lang', 't1')).toBe(true);
  expect(replies.at(-1).text).toMatch(/Ontvangen/);
});

test('full journey over the shared bus: message -> klaar -> verstuur alles -> pod', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('a');
  await surface.handle('De wachtlijst bij de GGZ is al maanden veel te lang', 'a');
  replies.length = 0;
  await surface.handle('ik ben klaar', 'a');
  expect(replies.at(-1).buttons?.some((b) => b.id === 'fp:consent:all')).toBe(true);   // buttons pass through
  await surface.handle('verstuur alles', 'a');
  expect(pod.list().length).toBe(1);
  expect(pod.list()[0].participant).toBe('cc:a');
});

test('consent is SIGNED with the participant identity (accepted by a verify pod)', async () => {
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  // The participant IS the on-device identity's public key (the surface's participantFor derives it from
  // the signer), so the roster binds that pubkey — distinct per identity, which is what keeps multiple
  // participants on the same invite/circle from collapsing to one pseudonym.
  roster.bind(id.publicKey, id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'canopy-chat' }) });
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ privacy: { verify: true } }), pod, identity: id, emit: (r) => replies.push(r) });

  await surface.start('s');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 's');
  await surface.handle('ik ben klaar', 's');
  await surface.tapButton('fp:consent:all', 's');   // a button TAP drives consent
  expect(pod.forAggregation().length).toBe(1);        // signed → verified → aggregated
});

test('seam 4 — a signer CLOSURE (from the host AgentIdentity) signs consent, accepted by a verify pod', async () => {
  // The host hands the bot a { publicKey, sign() } closure, NOT the raw key (private key stays
  // encapsulated in the AgentIdentity). contributionMeta signs consent with it → a verify pod accepts.
  const agent = new AgentIdentity({ seed: new Uint8Array(randomBytes(32)), vault: {} });
  const signer = signerForIdentity(agent);
  expect(signer).toEqual({ publicKey: agent.pubKey, sign: expect.any(Function) });   // closure shape, no privateKey
  const roster = new IdentityRoster();
  roster.bind(signer.publicKey, signer.publicKey);   // participant = the identity's pubkey (see above)
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'canopy-chat' }) });
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ privacy: { verify: true } }), pod, identityFor: () => signer, emit: (r) => replies.push(r) });

  await surface.start('z');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 'z');
  await surface.handle('ik ben klaar', 'z');
  await surface.tapButton('fp:consent:all', 'z');
  expect(pod.forAggregation().length).toBe(1);        // closure-signed → verified → aggregated
});

test('seam 4 — the signer is INERT for a non-verify project (no signing attempted)', async () => {
  // Gate: for a project WITHOUT privacy.verify (today's default), the surface wires no signer to the bot,
  // so consent writes stay unsigned exactly as before F2 — the injected sign() is never called.
  let signCalls = 0;
  const signer = { publicKey: 'ignored', sign: () => { signCalls += 1; return new Uint8Array(64); } };
  const { surface, pod } = setup({ surface: { identityFor: () => signer } });   // cfg() has no privacy.verify
  await surface.start('n');
  await surface.handle('De GGZ-wachtlijst is te lang', 'n');
  await surface.handle('ik ben klaar', 'n');
  await surface.tapButton('fp:consent:all', 'n');
  expect(pod.list().length).toBe(1);   // the write still lands (unsigned)
  expect(signCalls).toBe(0);           // no signer wired for a non-verify project
});

test('/report is intercepted as a surface affordance — emits a PII-safe log panel, never reaches the bot', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('r');
  // A free-text turn the bot WOULD normally process — so we can prove /report doesn't get routed to it.
  await surface.handle('De GGZ-wachtlijst is veel te lang', 'r');
  const podBefore = pod.list().length;
  replies.length = 0;

  expect(await surface.handle('/report', 'r')).toBe(true);   // handled (returns true) …
  const panel = replies.at(-1);
  expect(panel.kind).toBe('report');                          // … as a report panel, not a bot reply
  expect(panel.report).toBe(true);
  expect(panel.text).toMatch(/probleem|problem/i);            // localised header + intro
  expect(typeof panel.logText).toBe('string');
  expect(pod.list().length).toBe(podBefore);                  // it did NOT write / drive the journey

  // The panel is PII-safe by construction: the typed feedback text must never appear in the log.
  expect(panel.logText).not.toMatch(/wachtlijst/);
  // The `fp:report` button (web bubble-trigger) routes to the same interception.
  replies.length = 0;
  expect(await surface.handle('fp:report', 'r')).toBe(true);
  expect(replies.at(-1).kind).toBe('report');
});

test('reportButton — start() offers the web bubble-trigger with an fp:report button', async () => {
  const { surface, replies } = setup({ surface: { reportButton: true } });
  await surface.start('rb');
  expect(replies.some((r) => (r.buttons || []).some((b) => b.id === 'fp:report'))).toBe(true);
});

test('parseFeedbackInvite reads a project-invite link', () => {
  expect(parseFeedbackInvite('https://app.example/?projectId=gemeente-x&code=abc123')).toEqual({ projectId: 'gemeente-x', code: 'abc123' });
  expect(parseFeedbackInvite('projectId=p&code=c')).toEqual({ projectId: 'p', code: 'c' });
  expect(parseFeedbackInvite('https://app.example/?foo=bar')).toBe(null);
  expect(parseFeedbackInvite('')).toBe(null);
});

test('feedback threads stay isolated', async () => {
  const { surface, pod } = setup();
  await surface.start('x'); await surface.start('y');
  for (const tid of ['x', 'y']) {
    await surface.handle('GGZ wachtlijst te lang', tid);
    await surface.handle('klaar', tid);
    await surface.handle('verstuur alles', tid);
  }
  expect(new Set(pod.list().map((c) => c.participant))).toEqual(new Set(['cc:x', 'cc:y']));
});

test('chunkBubble — short text is not chunked; long text splits at a boundary and round-trips', () => {
  expect(chunkBubble('kort bericht')).toEqual({ head: 'kort bericht', rest: '' });

  const long = `${'Dit is een lange samenvatting. '.repeat(20)}Einde.`;
  const { head, rest } = chunkBubble(long, 120);
  expect(head.length).toBeLessThanOrEqual(120);
  expect(rest).not.toBe('');
  // no content lost (modulo the trimmed boundary whitespace)
  expect((head + ' ' + rest).replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim());
  // preferred a sentence boundary (head ends on a period, not mid-word)
  expect(head.endsWith('.')).toBe(true);
});

test('chunkBubble — a hard cut when there is no boundary in-window', () => {
  const noSpaces = 'x'.repeat(500);
  const { head, rest } = chunkBubble(noSpaces, 200);
  expect(head.length).toBe(200);
  expect(rest.length).toBe(300);
});

test('feedbackContactItem — distinct agent contact (id matches bot address, openFeedback action)', () => {
  const item = feedbackContactItem({ label: 'Feedback assistant', openLabel: 'Open chat' });
  expect(item.id).toBe('fp-bot');          // matches the co-hosted bot address
  expect(item.type).toBe('agent');
  expect(item.kind).toBe('agent');
  expect(item.icon).toBeTruthy();
  expect(item.label).toBe('Feedback assistant');
  expect(item.buttons).toEqual([{ label: 'Open chat', callbackData: 'openFeedback:fp-bot' }]);
});
