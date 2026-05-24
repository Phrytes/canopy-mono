/**
 * **Platform: web** (DOM-dependent).  RN parallel pending #128.
 *
 * canopy-chat — C5 post-audience picker (#198, 2026-05-24).
 *
 * Single-step rich UI that ENRICHES /post with audience targeting.
 * Per the audit's S8 finding: stoop's substrate has an audience model
 * (subset of group + per-tag + distance) but no compositional UI.
 * The wizard collects audience config + calls postRequest with the
 * extended args; substrate uses them when audience-filter ships, or
 * stores them with the post for later honour.
 *
 * Audience composition (all optional, intersected):
 *   - Trust level: known / trusted / all-known
 *   - Tags (CSV) — match contacts with any of these tags
 *   - Distance (km grid: 1 / 2 / 5 / 10 / 25 / no-limit)
 *   - Explicit webids (CSV)
 *
 * Substrate skill: postRequest (existing).  Args extended with
 * `audience: { minTrust, tags, distanceKm, recipients }`.  If stoop
 * ignores the audience field today, the post still files; the
 * audience intent is preserved for when stoop wires audience-filter.
 */

import { mkBody, mkActions, mkField, mkTextarea, mkRadioGroup, mkError, mkSubmitting, refreshActions } from './_wizardKit.js';

const TRUST_OPTS = [
  { id: 'all',      label: 'Everyone in the buurt' },
  { id: 'known',    label: 'Known contacts only' },
  { id: 'trusted',  label: 'Trusted contacts only' },
];

const DISTANCE_OPTS = [
  { km: 1, label: '1 km' }, { km: 2, label: '2 km' }, { km: 5, label: '5 km' },
  { km: 10, label: '10 km' }, { km: 25, label: '25 km' }, { km: 0, label: 'No limit' },
];

export function renderPostAudienceWizard(opts) {
  const { container, doc, args, callSkill, onClose, onDispatched } = opts;
  const state = {
    text:        args?.text ?? '',
    kind:        args?.kind ?? 'ask',
    minTrust:    'all',
    tags:        '',
    distanceKm:  0,
    recipients:  '',
    submitting:  false,
    submitError: null,
  };
  rerender();

  function rerender() {
    container.innerHTML = '';
    const body = mkBody(doc, 'Post with audience',
      'Pick a target audience.  Empty = everyone in your buurt.');
    const validText = () => state.text.trim().length > 0;
    mkTextarea(body, doc, 'Post text', state.text, (v) => {
      state.text = v;
      refreshActions(container, { textOk: validText });
    }, { placeholder: 'What are you asking / offering?', rows: 3 });
    // Radio + distance buttons change visible UI; rerender is safe
    // (no text input focus to preserve at those points).
    mkRadioGroup(body, doc, 'Kind', state.kind, [
      { id: 'ask', label: 'Ask (request help)' },
      { id: 'offer', label: 'Offer (share skills/items)' },
      { id: 'lend',  label: 'Lend (share a physical thing)' },
    ], (v) => { state.kind = v; });
    mkRadioGroup(body, doc, 'Trust level', state.minTrust, TRUST_OPTS,
      (v) => { state.minTrust = v; });
    mkField(body, doc, 'Tags (CSV — match contacts with any tag)',
      state.tags, (v) => { state.tags = v; },
      { placeholder: 'e.g. tools, gardening, kids' });

    // km distance grid
    const distLabel = doc.createElement('div');
    distLabel.className = 'cc-wizard-field-label';
    distLabel.textContent = 'Max distance';
    body.appendChild(distLabel);
    const distGrid = doc.createElement('div');
    distGrid.className = 'cc-wizard-distance-grid';
    for (const d of DISTANCE_OPTS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = `cc-wizard-distance ${state.distanceKm === d.km ? 'cc-wizard-distance-active' : ''}`;
      btn.textContent = d.label;
      btn.addEventListener('click', () => { state.distanceKm = d.km; rerender(); });
      distGrid.appendChild(btn);
    }
    body.appendChild(distGrid);

    mkField(body, doc, 'Specific webids (CSV, optional)',
      state.recipients, (v) => { state.recipients = v; },
      { placeholder: 'e.g. webid:anne,webid:karl', monospace: true,
        hint: 'When set, restricts to these recipients regardless of trust/distance.' });

    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Posting…');
    container.appendChild(body);
    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'Post',   onClick: async () => {
        state.submitting = true;
        state.submitError = null;
        rerender();
        try {
          const audience = {
            minTrust:    state.minTrust === 'all' ? null : state.minTrust,
            tags:        state.tags.split(',').map((s) => s.trim()).filter(Boolean),
            distanceKm:  state.distanceKm || null,
            recipients:  state.recipients.split(',').map((s) => s.trim()).filter(Boolean),
          };
          for (const k of Object.keys(audience)) {
            if (audience[k] === null || (Array.isArray(audience[k]) && audience[k].length === 0)) {
              delete audience[k];
            }
          }
          const result = await callSkill('stoop', 'postRequest', {
            text: state.text, kind: state.kind,
            ...(Object.keys(audience).length > 0 ? { audience } : {}),
          });
          if (result?.error) throw new Error(result.error);
          if (typeof onDispatched === 'function') {
            try { onDispatched({ ok: true, message: '✓ Posted to your buurt.', ...result }); } catch {}
          }
          onClose();
        } catch (err) {
          state.submitError = err?.message ?? String(err);
          state.submitting = false;
          rerender();
        }
      }, kind: 'primary', validate: 'textOk',
        disabled: state.submitting || state.text.trim().length === 0 },
    ]);
  }
}
