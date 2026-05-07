/**
 * chat — pure helpers for ChatThreadsScreen / ChatThreadScreen.
 *
 *   - sortThreadsByActivity   most-recently-active thread first
 *   - formatUnreadBadge       "12+" cap so a long inbox doesn't
 *                             blow out the badge layout
 *   - validateChatDraft       text + ≤1 attachment per message
 *
 * Stoop V3 uses `chat-p2p`'s envelope shape for messages
 * (`{from, ts, text?, attachment?}`) — these helpers operate over
 * that shape directly.
 */

export const CHAT_MAX_BODY_LEN = 4000;
export const CHAT_MAX_ATTACHMENTS = 1;
export const UNREAD_BADGE_CAP = 12;

/**
 * @typedef {object} Thread
 * @property {string}  id
 * @property {string}  peerId
 * @property {number}  [lastActivity]   epoch-ms
 * @property {number}  [unreadCount]
 * @property {string}  [lastMessagePreview]
 */

/**
 * Stable sort: most-recent activity first. Threads without activity
 * sink to the bottom in id order.
 *
 * @param {Thread[]} threads
 * @returns {Thread[]}  new array
 */
export function sortThreadsByActivity(threads) {
  if (!Array.isArray(threads)) return [];
  return threads.slice().sort((a, b) => {
    const ta = (typeof a?.lastActivity === 'number') ? a.lastActivity : 0;
    const tb = (typeof b?.lastActivity === 'number') ? b.lastActivity : 0;
    if (tb !== ta) return tb - ta;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

/**
 * Render the unread-count as a short badge string. `null` for 0.
 * `'12+'` for anything past the cap.
 */
export function formatUnreadBadge(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  if (n > UNREAD_BADGE_CAP) return `${UNREAD_BADGE_CAP}+`;
  return String(n);
}

/**
 * Validate a per-message draft.
 *
 * @param {{text?: string, attachment?: object}} draft
 * @returns {{ ok: true } | { ok: false, reason: 'no_content'|'too_long' }}
 */
export function validateChatDraft(draft) {
  if (!draft || typeof draft !== 'object') return { ok: false, reason: 'no_content' };
  const text = (draft.text ?? '').trim();
  const hasAtt = !!draft.attachment;
  if (text.length === 0 && !hasAtt) return { ok: false, reason: 'no_content' };
  if (text.length > CHAT_MAX_BODY_LEN) return { ok: false, reason: 'too_long' };
  return { ok: true };
}

/**
 * Group consecutive same-author messages so the bubble UI can
 * collapse repeat avatars / timestamps.
 *
 * @param {Array<{from: string, ts?: number, text?: string, attachment?: object}>} messages
 * @returns {Array<{from: string, items: Array<object>}>}
 */
export function groupConsecutive(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out = [];
  let cur = null;
  for (const m of messages) {
    if (!m) continue;
    if (cur && cur.from === m.from) {
      cur.items.push(m);
    } else {
      cur = { from: m.from, items: [m] };
      out.push(cur);
    }
  }
  return out;
}
