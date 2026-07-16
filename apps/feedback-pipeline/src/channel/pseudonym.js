// Participant pseudonym for host-run channel bots (Telegram, later WhatsApp).
//
// A channel gives us a REVERSIBLE native id (a Telegram chatId, a WhatsApp phone number).
// Storing that on the pod would let the pod host reverse-map every contribution to a real
// person — and the id space is small enough to brute-force a plain hash. So we derive a
// KEYED HMAC: without the secret (held by the bot service / a TEE, never on the pod) the
// pseudonym can't be reversed, while the same id → the same pseudonym across sessions.
import { createHmac } from 'node:crypto';

/**
 * @param {string} secret  a stable per-deployment secret (held off the pod).
 * @param {string|number} id  the channel-native id (chatId, phone number, …).
 * @param {string} [prefix]  short tag, default 'p'.
 * @returns {string}  e.g. "p-9f3a1c7b2e4d5a6f" — non-reversible without `secret`.
 */
export function hmacPseudonym(secret, id, prefix = 'p') {
  if (!secret) throw new Error('hmacPseudonym: a secret is required (never derive a pseudonym unkeyed)');
  return `${prefix}-${createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 16)}`;
}
