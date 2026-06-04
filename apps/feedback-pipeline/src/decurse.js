// Deterministic profanity floor for the de-curse pass. The LLM pass does the
// nuanced, grammar-smoothing work; this guarantees a fixed set of swear words /
// slurs is gone even if the model misses one (applied AFTER the LLM pass). It
// is a FLOOR, not a complete filter — contextual insults are the LLM's job.

const PROFANITY = [
  // Dutch
  /\bgodver(domme|dorie|de)?\b/gi, /\bgvd\b/gi, /\bklote\b/gi, /\bkut\b/gi,
  /\bkanker\w*/gi, /\btyfus\w*/gi, /\btering\b/gi, /\bhufter\b/gi,
  /\bklootzak\w*/gi, /\bsukkel\b/gi, /\bdebiel\b/gi, /\bmongool\b/gi,
  /\beikel\b/gi, /\bidioot\b/gi, /\blul\b/gi,
  // English
  /\bfuck\w*/gi, /\bshit\w*/gi, /\bbullshit\b/gi, /\bbastard\w*/gi,
  /\bidiot\w*/gi, /\bmoron\w*/gi, /\basshole\w*/gi, /\bbitch\w*/gi,
  /\bcrap\b/gi, /\bdamn\w*/gi, /\bprick\b/gi, /\bcrook\w*/gi,
];

/**
 * Remove known profanity/slurs and tidy the surrounding spacing/punctuation.
 * @returns {{ text: string, removed: number }}
 */
export function decurseDeterministic(text) {
  let removed = 0;
  let out = text;
  for (const re of PROFANITY) out = out.replace(re, () => { removed++; return ''; });
  // tidy: collapse doubled spaces, fix " ," / " ." and stray leading punctuation
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\(\s*\)/g, '').trim();
  return { text: out, removed };
}

/** Does the text still contain known profanity? (self-check helper) */
export function hasProfanity(text) {
  return PROFANITY.some((re) => { re.lastIndex = 0; return re.test(text); });
}
