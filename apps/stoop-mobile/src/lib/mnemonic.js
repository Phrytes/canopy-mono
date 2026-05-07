/**
 * mnemonic — pure helpers for the OnboardRestore screen.
 *
 * BIP-39 wordlist validation lives in the SDK (
 * `@scure/bip39/wordlists/english` + `validateMnemonic`). The
 * screen-side helpers below only need to:
 *
 *   1. Normalise the user's input (lowercase, collapse whitespace).
 *   2. Tell whether the word count is on the BIP-39 ladder.
 *   3. Tell whether every "word" looks BIP-39-shaped (lowercase
 *      ASCII, length 3-8). Deeper validation against the wordlist
 *      is the SDK's job — the screen surfaces the SDK's verdict.
 *
 * The same shape is used by `qrScanner.classifyQrPayload` for QR-
 * scanned recovery phrases; the two are deliberately consistent.
 */

export const BIP39_WORD_COUNTS = Object.freeze(new Set([12, 15, 18, 21, 24]));

const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 8;

/**
 * Lowercase the input, collapse whitespace runs to a single space,
 * trim leading/trailing whitespace.
 */
export function normaliseMnemonic(text) {
  if (typeof text !== 'string') return '';
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Split a normalised mnemonic into its words.
 */
export function mnemonicWords(text) {
  const norm = normaliseMnemonic(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Is the word count valid?  Doesn't validate against the BIP-39
 * wordlist — only the cardinality.
 */
export function hasValidWordCount(text) {
  return BIP39_WORD_COUNTS.has(mnemonicWords(text).length);
}

/**
 * Are all words lowercase ASCII letters of plausible BIP-39 length?
 * Cheap structural check; the SDK's `validateMnemonic` is the
 * authoritative wordlist gate.
 */
export function looksLikeMnemonic(text) {
  const words = mnemonicWords(text);
  if (!BIP39_WORD_COUNTS.has(words.length)) return false;
  return words.every((w) =>
    /^[a-z]+$/.test(w) &&
    w.length >= MIN_WORD_LEN &&
    w.length <= MAX_WORD_LEN);
}

/**
 * Return a short status string the UI can render under the input
 * field as the user types. The screen uses these keys to look up
 * localised strings.
 *
 * @returns {'empty' | 'too_short' | 'wrong_count' | 'malformed_word' | 'looks_ok'}
 */
export function statusFor(text) {
  const words = mnemonicWords(text);
  if (words.length === 0) return 'empty';
  // Surface the most-helpful message: prefer "wrong count" when we
  // have multiple words but not 12/15/18/21/24, "too short" only
  // for the very-empty trickle.
  if (words.length < 12) return words.length <= 3 ? 'too_short' : 'wrong_count';
  if (!BIP39_WORD_COUNTS.has(words.length)) return 'wrong_count';
  for (const w of words) {
    if (!/^[a-z]+$/.test(w))                           return 'malformed_word';
    if (w.length < MIN_WORD_LEN || w.length > MAX_WORD_LEN) return 'malformed_word';
  }
  return 'looks_ok';
}
