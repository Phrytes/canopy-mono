// Natural-language intent classification for the canopy-chat surface (free text, no slash
// commands). canopy-chat historically let participants type naturally and an LLM mapped
// intent; this is that layer. Hybrid, in the floors spirit: a deterministic fast-path for
// short, unambiguous control utterances, then the LLM (the app's own route — local /
// Privatemode / OVH via src/ollama.js) for the rest, defaulting to "it's feedback content".
//
// Returns an action in the shared shape (see actions.js). The DEFAULT is always
// { kind: 'message' } — feedback content is the common case and the safe fallback (the
// participant reviews before anything is shared anyway).

import { chat } from '../ollama.js';

// ANCHORED, near-exact control phrases: a match means the WHOLE short message is the
// command, so a feedback message that merely contains a keyword ("stop met dit beleid",
// "bekijk dit probleem") is left to the LLM/default, not mistaken for a command.
const DET = [
  [/^(\/)?(klaar|done|review|ik ben klaar|ben klaar|laat (het |me )?(maar )?zien|i'?m done)[.!\s]*$/i, () => ({ kind: 'review' })],
  [/^(verstuur|stuur|send|submit|deel)\s+(alles|all|ze allemaal|everything)[.!\s]*$/i, () => ({ kind: 'consent', all: true })],
  [/^(alles|allemaal|all|everything)\s+(versturen|verstuur|sturen|send|delen|submit)[.!\s]*$/i, () => ({ kind: 'consent', all: true })],
  [/^(niets( versturen| te delen)?|nothing|annuleer|cancel|laat maar( zitten)?)[.!\s]*$/i, () => ({ kind: 'cancel' })],
  [/^(menu|help|\?)[.!\s]*$/i, () => ({ kind: 'menu' })],
  [/^(mijn bijdragen|my contributions|wat heb ik (verstuurd|gedeeld)|what did i (send|submit|share))[?.!\s]*$/i, () => ({ kind: 'my-contributions' })],
  // edit a point by number ("bewerk punt 2", "verander punt 2", "edit 2", "change point 2") → opens its editor.
  [/^(?:bewerk|verander|wijzig|pas|edit|change)\s+(?:punt\s+|point\s+)?(\d+)\s*(?:aan)?[.!?\s]*$/i, (m) => ({ kind: 'edit-point', id: `p${m[1]}` })],
];

function deterministicIntent(text) {
  if (text.split(/\s+/).filter(Boolean).length > 6) return null;   // long → content; LLM/default decides
  for (const [re, make] of DET) { const m = text.match(re); if (m) return make(m); }
  return null;
}

const SYS = [
  'You classify a participant message in a civic feedback tool. The participant either sends',
  'FEEDBACK CONTENT (an opinion/experience to collect) or gives an INSTRUCTION about the tool.',
  'Respond with ONLY a JSON object, no prose:',
  '{"intent":"message|review|consent_all|consent_one|my_contributions|menu|cancel","index":<number optional>}',
  '- message: the text is feedback content (DEFAULT when unsure).',
  '- review: they want to see/check their points before sending ("I\'m done", "let me see").',
  '- consent_all: send/share all their points.',
  '- consent_one: send one specific point; include its 1-based "index" if stated.',
  '- my_contributions: show what they already sent.',
  '- menu / cancel: show options / send nothing.',
].join('\n');

function actionFor(obj, text) {
  switch (obj?.intent) {
    case 'review': return { kind: 'review' };
    case 'consent_all': return { kind: 'consent', all: true };
    case 'consent_one': return Number.isInteger(obj.index) ? { kind: 'consent', index: obj.index } : { kind: 'review' };
    case 'my_contributions': return { kind: 'my-contributions' };
    case 'menu': return { kind: 'menu' };
    case 'cancel': return { kind: 'cancel' };
    case 'message': return { kind: 'message', text };
    default: return null;
  }
}

/**
 * @param {string} text
 * @param {{ model?:string }} [opts]   model enables the LLM step; omit for deterministic-only
 * @returns {Promise<object>} an action ({ kind, ... })
 */
export async function classifyIntent(text, { model } = {}) {
  const t = (text || '').trim();
  if (!t) return { kind: 'message', text: t };

  const det = deterministicIntent(t);
  if (det) return det;

  if (model) {
    const r = await chat(model, SYS, t, { numPredict: 40 });
    if (r.ok) {
      const m = r.text.match(/\{[\s\S]*\}/);
      if (m) { try { return actionFor(JSON.parse(m[0]), t) || { kind: 'message', text: t }; } catch { /* fall through */ } }
    }
  }
  return { kind: 'message', text: t };   // safe default: feedback content
}
