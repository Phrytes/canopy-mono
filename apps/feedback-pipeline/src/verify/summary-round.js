// The verify-summary loop — own-pod-first, user-verified release to central.
// See docs/DESIGN-verify-summary-loop.md. Stage 1 (contribute) writes raw to the participant's OWN pod;
// Stage 2 (lead-triggered) summarises the own pod ON-DEVICE, the user verifies, and ONLY the verified
// summary is sealed+signed to the CENTRAL pod. The raw never leaves the own pod.
//
// Pure module: the pods, identity, and model are injected. Reuses the existing consent-write primitives
// (buildContribution + contributionMeta) and the pipeline's summarize() — the verified summary IS just a
// contribution whose text is the summary, tagged 'verified-summary'.
import { summarize } from '../pipeline.js';
import { buildContribution } from '../pod/contribution.js';
import { contributionMeta } from '../pod/signing.js';

/**
 * Stage 2a — generate a per-participant summary DRAFT from the participant's OWN-pod contributions.
 * Runs on-device; the summarize() LLM call goes through the (loopback) confidential proxy. Raw never leaves.
 *
 * @param {object}  a
 * @param {{forAggregation?:Function, list:Function}} a.ownPod  the participant's own pod
 * @param {string}  a.participant   participant key (filters the own pod to this participant's records)
 * @param {string}  a.model         summarize model
 * @param {string}  a.projectId
 * @param {number|string} a.round
 * @param {object}  [a.opts]        summarize opts (e.g. { lang })
 * @returns {Promise<{projectId, round, summary, points:Array<{id,text}>, curatedFrom:string[], generatedAt:string}>}
 */
export async function summariseOwnContributions({ ownPod, participant, model, projectId, round, opts = {} }) {
  const records = await (typeof ownPod.forAggregation === 'function' ? ownPod.forAggregation() : ownPod.list());
  const mine = (Array.isArray(records) ? records : [])
    .filter((r) => !participant || (r.user ?? r.participant) === participant);
  const points = mine.map((r) => ({ id: r.id ?? r.contribution?.id, text: r.text ?? r.contribution?.text }))
    .filter((p) => p.text);
  let summary = '';
  if (points.length) {
    const r = await summarize(model, points.map((p) => p.text), opts);   // → { ok, text, … }
    summary = r && r.ok && r.text ? r.text : '';
  }
  return {
    projectId, round, summary, points,
    curatedFrom: points.map((p) => p.id),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Stage 2b — on VERIFY: build a signed verified-summary contribution + seal+write it to the CENTRAL pod.
 * Reuses the consent-write primitives. The participant's raw stays in their own pod; only this leaves.
 *
 * @param {object} a
 * @param {{write:Function}} a.centralPod
 * @param {{projectId, round, summary}} a.draft  the (possibly user-edited) summary draft
 * @param {object} a.identity         the participant's signing identity (contributionMeta signs with it)
 * @param {string} a.participant
 * @param {object} [a.timeWindow]
 * @param {string} [a.lang]
 * @returns {Promise<string>} the verified-summary contribution id
 */
export async function releaseVerifiedSummary({ centralPod, draft, identity, participant, timeWindow, lang }) {
  if (!draft || !draft.summary) throw new Error('releaseVerifiedSummary: an empty summary cannot be released');
  const cid = `${participant}:summary:${draft.round}`;
  const contribution = buildContribution(
    { id: cid, text: draft.summary },
    { timeWindow, lang, themeTags: ['verified-summary'] },
  );
  const meta = contributionMeta(identity, { projectId: draft.projectId, participant, contribution });
  await centralPod.write(participant, contribution, meta);
  return cid;
}
