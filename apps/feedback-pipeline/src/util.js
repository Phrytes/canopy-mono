// Small shared helpers.

/**
 * Return up to n random elements of arr (Fisher–Yates, non-mutating).
 * Used to ROTATE few-shot examples per call so the pipeline doesn't overfit
 * to one fixed example set. Math.random is fine here (plain scripts, not a
 * Workflow); rotation only affects which examples prime the LLM, never the
 * deterministic unit tests.
 */
export function sample(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

/** Flatten [userText, assistantText] pairs into chat-message turns. */
export function pairsToTurns(pairs) {
  return pairs.flatMap(([user, assistant]) => [
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ]);
}

// ── Token shielding ─────────────────────────────────────────────────
// Best practice (LLM masking / localisation): before a generative step that
// might reword or translate them (summarize, translate), replace the canonical
// [placeholder] tokens with opaque, structure-light markers [[0]], [[1]], …
// and keep a map for LOSSLESS round-trip restoration. The model passes opaque
// markers through verbatim far more reliably than "[telefoonnummer]" (which it
// will happily translate to "[phone number]").

const SHIELD_RE = /\[(?:telefoonnummer|e-mailadres|rekeningnummer|postcode|adres|bsn|naam|link)\]/g;

/** @returns {{ shielded: string, map: string[] }} */
export function shield(text) {
  const map = [];
  const shielded = text.replace(SHIELD_RE, (m) => {
    const id = `[[${map.length}]]`;
    map.push(m);
    return id;
  });
  return { shielded, map };
}

/** Restore [[n]] markers back to their canonical tokens. */
export function unshield(text, map) {
  return text.replace(/\[\[(\d+)\]\]/g, (full, n) => map[Number(n)] ?? full);
}
