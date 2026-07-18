/**
 * Parameterised system-prompt builder.  Pure: same inputs ⇒ same string.
 *
 * The builder is deliberately small + knob-driven so can wire its
 * `preamble` / `perToolLine` / `postamble` to reproduce household's
 * `SYSTEM_PROMPT_CLASSIFY` byte-for-byte (or, per PLAN §1.6, a documented
 * normalisation thereof if the hand-written prose can't be regenerated
 * exactly).
 *
 * @param {import('../schema.js').Manifest} manifest
 * @param {object} [opts]
 * @param {string} [opts.preamble]
 * @param {(op: import('../schema.js').Operation) => string} [opts.perToolLine]
 *   Default: "- ${id}: ${chat.hint || id}".
 * @param {string} [opts.postamble]
 * @returns {string}
 */
export function buildPrompt(manifest, opts = {}) {
  const preamble    = opts.preamble    ?? defaultPreamble(manifest);
  const postamble   = opts.postamble   ?? '';
  const perToolLine = opts.perToolLine ?? defaultPerToolLine;

  const ops   = Array.isArray(manifest?.operations) ? manifest.operations : [];
  const lines = [preamble, '', 'Available tools:'];
  for (const op of ops) lines.push(perToolLine(op));
  if (postamble) { lines.push('', postamble); }

  return lines.join('\n');
}

function defaultPreamble(manifest) {
  const app = manifest?.app ?? 'this';
  return `You are an assistant for the "${app}" app.`;
}

function defaultPerToolLine(op) {
  const hint = op?.surfaces?.chat?.hint ?? op?.id ?? '';
  return `- ${op?.id ?? ''}: ${hint}`;
}
