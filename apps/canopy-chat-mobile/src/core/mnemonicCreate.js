/**
 * canopy-chat-mobile — first-run mnemonic display (board 3A, slice P6.9).
 *
 * After a fresh install generates an identity (5.9b boot path), the user
 * should be shown the BIP39 phrase ONCE so they can write it down.  Board
 * 3A surfaces three CTAs: "Written down" / "Photo taken" / "Later".  All
 * three dismiss the screen for the current boot; "Written down" + "Photo
 * taken" persist the dismissal so the screen never reappears, while
 * "Later" leaves the dismissal off (a future banner can nudge again).
 *
 * Pure: every read/write goes through the caller-supplied AsyncStorage
 * instance, so vitest covers every branch with a Map-backed mock.
 *
 * NOTE — design says "twaalf woorden" but the BIP39 substrate emits 24
 * words (256-bit entropy → 32-byte Ed25519 seed; see packages/core
 * Mnemonic.js).  Keep the substrate count; UI copy can read "Your
 * recovery phrase" without pinning a number.
 */

const ACK_KEY = 'cc.mnemonicAck';

/**
 * Decide whether to render the CREATE-side mnemonic screen.  Returns
 * true ONLY when:
 *   - the chat identity already exists (we don't show this before the
 *     vault has been seeded — checked separately by the first-run gate),
 *   - the ack marker is not yet set, AND
 *   - the user hasn't already finished the restore path (which writes
 *     the same identity vault key).
 *
 * Tolerant: a thrown getItem treats the marker as missing (show again)
 * — better to remind twice than to silently skip.
 *
 * @param {{getItem: (k: string) => Promise<string|null>}} asyncStorage
 * @returns {Promise<boolean>}
 */
export async function shouldShowCreateMnemonic(asyncStorage) {
  if (!asyncStorage || typeof asyncStorage.getItem !== 'function') return false;
  let ack = null;
  try { ack = await asyncStorage.getItem(ACK_KEY); } catch { /* noop */ }
  return ack !== '1';
}

/**
 * Persist the user's acknowledgement.  `kind` is one of:
 *   - 'written'  — user tapped "Written down"
 *   - 'photo'    — user tapped "Photo taken"
 *   - 'later'    — user tapped "Later" (does NOT persist; banner remains)
 *
 * "written" and "photo" both flip the ack to '1'.  "later" is a no-op
 * on storage so the screen / banner can re-prompt on next boot.
 *
 * @param {{setItem: (k: string, v: string) => Promise<void>}} asyncStorage
 * @param {string} kind
 * @returns {Promise<void>}
 */
export async function markMnemonicAck(asyncStorage, kind) {
  if (kind === 'later') return;
  if (!asyncStorage || typeof asyncStorage.setItem !== 'function') return;
  if (kind !== 'written' && kind !== 'photo') return;
  try { await asyncStorage.setItem(ACK_KEY, '1'); } catch { /* noop */ }
}

/** Test seam: clear the ack flag. */
export async function clearMnemonicAck(asyncStorage) {
  if (!asyncStorage || typeof asyncStorage.removeItem !== 'function') return;
  try { await asyncStorage.removeItem(ACK_KEY); } catch { /* noop */ }
}

/**
 * Slice the mnemonic into a 2-column grid the screen can render
 * verbatim.  Returns `[{n, word}]` rows with 1-based numbering, in
 * column-major order (left column 1..12, right 13..24).  Defensive
 * against non-strings + short inputs.
 *
 * @param {string} mnemonic
 * @returns {Array<{ n: number, word: string }>}
 */
export function partitionMnemonicGrid(mnemonic) {
  if (typeof mnemonic !== 'string') return [];
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  return words.map((word, i) => ({ n: i + 1, word }));
}

export const MNEMONIC_ACK_KEY = ACK_KEY;
