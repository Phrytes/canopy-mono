/**
 * 5.9b-followup — boot-time BIP39 restore on mobile.
 *
 * Pure orchestrator that takes a user-typed 24-word BIP39 mnemonic,
 * validates it (BIP39 wordlist + checksum), and seeds the chat-side
 * vault with the derived Ed25519 keypair under the same key that
 * `bootAgentBundle` consults on the NEXT boot (`cc-chat-id:agent-privkey`).
 *
 * Once this resolves with { ok: true } the caller flips the first-run
 * gate to 'dismissed' and lets bootAgentBundle proceed — it will find
 * the seeded vault and use it instead of generating a fresh keypair.
 *
 * Errors map to a stable `code` so the UI can render a localized
 * message without depending on the underlying BIP39 library's wording:
 *
 *   - 'empty'         — input is empty or whitespace
 *   - 'wrong-length'  — not 24 words
 *   - 'invalid'       — fails BIP39 wordlist or checksum check
 *   - 'storage'       — AsyncStorage threw while persisting
 *
 * The helper is pure (DI'd AsyncStorage) so vitest covers the full
 * decision tree against a Map-backed mock — no RN runtime needed.
 */
import { AgentIdentity, validateMnemonic } from '@canopy/core';
import { VaultAsyncStorage } from '../../../../packages/react-native/src/identity/VaultAsyncStorage.js';

const REQUIRED_WORDS = 24;
const CHAT_VAULT_PREFIX = 'cc-chat-id:';

/**
 * Restore the chat-side identity from a user-typed mnemonic.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic              — raw text (will be trimmed + collapsed)
 * @param {object} opts.asyncStorage          — AsyncStorage adapter
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export async function restoreFromMnemonic({ mnemonic, asyncStorage }) {
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) return { ok: false, code: 'empty' };

  const words = normalized.split(' ');
  if (words.length !== REQUIRED_WORDS) {
    return { ok: false, code: 'wrong-length' };
  }
  if (!validateMnemonic(normalized)) {
    return { ok: false, code: 'invalid' };
  }

  try {
    const vault = new VaultAsyncStorage({
      prefix: CHAT_VAULT_PREFIX,
      asyncStorage,
    });
    await AgentIdentity.fromMnemonic(normalized, vault);
  } catch (err) {
    return { ok: false, code: 'storage', detail: err?.message ?? String(err) };
  }
  return { ok: true };
}

/**
 * Trim, lowercase, and collapse internal whitespace so users can paste
 * with double spaces / line breaks / mixed case without surprises.
 */
export function normalizeMnemonic(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Quick word-count read (no validation) — drives the live progress hint in the UI. */
export function countMnemonicWords(input) {
  const n = normalizeMnemonic(input);
  return n === '' ? 0 : n.split(' ').length;
}

export const MNEMONIC_WORD_COUNT = REQUIRED_WORDS;
export const CHAT_VAULT_KEY_PREFIX = CHAT_VAULT_PREFIX;
