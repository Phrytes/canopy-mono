/**
 * chatThread — portable helpers for the 1:1 chat-thread surface.
 *
 * Slice #252 (2026-05-27) — web parity surface for tasks-mobile's
 * `ChatThreadScreen.jsx`. The mobile screen and the web page share
 * the same skills (`getChatThread`, `sendChatMessage`, `appealTask`)
 * and the same thread-id convention (`appeal:<taskId>`).
 *
 * This file collects the pure-JS glue both surfaces consume:
 *
 *   - `parseChatLocation(query)` — turn `?threadId=…&counterparty=…&
 *     appealForTaskId=…` into a typed `{threadId, counterparty,
 *     appealForTaskId}` triple. Returns `null` when threadId is
 *     missing so callers can render the no-thread error state.
 *   - `normaliseChatMessages(raw)` — flatten the substrate's
 *     chat-message item shape into the `{id, from, to, ts, body}`
 *     view-model the mobile screen + web page both render.
 *   - `pickRecipient(messages, opts)` — heuristic that picks the
 *     "other party" out of an existing thread when the caller didn't
 *     pass `counterparty` explicitly. Mirrors mobile's `useMemo`.
 *   - `shouldUseAppeal({appealForTaskId, messageCount})` — decide
 *     whether the next send should go through `appealTask`
 *     (first-message-on-an-appeal-thread) or `sendChatMessage`.
 *   - `buildSendArgs({threadId, recipient, body})` — payload for
 *     `sendChatMessage`. Recipient is optional (the skill accepts
 *     `toWebid` / `toStableId` / `toPubKey`; web only knows webid).
 *   - `buildAppealArgs({taskId, body})` — payload for `appealTask`.
 *   - `shortWebid(webid)` — same trimming as ChatThreadScreen's
 *     `_short`. 14 chars + ellipsis.
 *   - `formatTimestamp(ms)` — `HH:mm`. Same as mobile's `_fmtTime`.
 *
 * Discipline: every helper is platform-neutral (no DOM, no
 * react-native). The web page in `apps/tasks-v0/web/chat.html`
 * consumes them via `/lib/chatThread.js` (overlay registered in
 * `bin/tasks-ui.js`); tests run them under Node in vitest.
 */

const TASK_ID_PREFIX = 'appeal:';

/**
 * Parse a URLSearchParams-compatible source into the chat-page route
 * params. Tolerant of `URLSearchParams`, plain objects, and `null`.
 *
 * @param {URLSearchParams | object | null | undefined} input
 * @returns {{threadId: string, counterparty: string|null, appealForTaskId: string|null} | null}
 */
export function parseChatLocation(input) {
  if (input == null) return null;
  const get = (k) => {
    if (typeof input.get === 'function') {
      const v = input.get(k);
      return typeof v === 'string' ? v : null;
    }
    const v = input[k];
    return typeof v === 'string' ? v : null;
  };
  const threadId = get('threadId');
  if (typeof threadId !== 'string' || !threadId) return null;
  const counterparty    = get('counterparty')    || null;
  const appealForTaskId = get('appealForTaskId') || null;
  return { threadId, counterparty, appealForTaskId };
}

/**
 * Derive a thread id from a task id for the appeal flow.
 *
 * @param {string} taskId
 * @returns {string}
 */
export function appealThreadId(taskId) {
  if (typeof taskId !== 'string' || !taskId) {
    throw new TypeError('appealThreadId: taskId required');
  }
  return `${TASK_ID_PREFIX}${taskId}`;
}

/**
 * Extract the task id from an appeal-thread id; null when the thread
 * is not an appeal thread.
 *
 * @param {string} threadId
 * @returns {string | null}
 */
export function taskIdFromAppealThread(threadId) {
  if (typeof threadId !== 'string') return null;
  return threadId.startsWith(TASK_ID_PREFIX)
    ? threadId.slice(TASK_ID_PREFIX.length)
    : null;
}

/**
 * Flatten the substrate's chat-message item shape into the
 * view-model the chat thread renders.
 *
 * @param {Array<object> | null | undefined} raw
 * @returns {Array<{id: string, from: string|null, to: string|null, ts: number, body: string}>}
 */
export function normaliseChatMessages(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((m, i) => ({
    id:   m?.id ?? `${m?.source?.sentAt ?? `i${i}`}`,
    from: m?.source?.fromWebid ?? m?.addedBy ?? null,
    to:   m?.source?.toWebid   ?? null,
    ts:   m?.source?.sentAt    ?? m?.addedAt ?? 0,
    body: m?.text ?? m?.body ?? '',
  }));
}

/**
 * Pick the "other party" out of an existing thread when the caller
 * didn't pass a counterparty explicitly. Walks messages in order;
 * the first not-self webid wins. Mirrors mobile's heuristic.
 *
 * @param {Array<{from: string|null, to: string|null}>} messages
 * @param {{selfWebid: string|null, counterparty?: string|null}} opts
 * @returns {string | null}
 */
export function pickRecipient(messages, { selfWebid, counterparty } = {}) {
  if (counterparty) return counterparty;
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    if (m?.from && m.from !== selfWebid) return m.from;
    if (m?.to   && m.to   !== selfWebid) return m.to;
  }
  return null;
}

/**
 * Decide whether the next send should go through `appealTask`
 * instead of `sendChatMessage`.
 *
 * Returns true when (a) the caller passed an `appealForTaskId` AND
 * (b) the thread is still empty — mirrors mobile's
 * `useAppeal = appealForTaskId && messages.length === 0`.
 *
 * @param {{appealForTaskId: string|null|undefined, messageCount: number}} args
 * @returns {boolean}
 */
export function shouldUseAppeal({ appealForTaskId, messageCount } = {}) {
  if (typeof appealForTaskId !== 'string' || !appealForTaskId) return false;
  return Number(messageCount ?? 0) === 0;
}

/**
 * Build the payload for `sendChatMessage`.
 *
 * @param {{threadId: string, recipient?: string|null, body: string}} args
 * @returns {{threadId: string, toWebid?: string, body: string}}
 */
export function buildSendArgs({ threadId, recipient, body } = {}) {
  if (typeof threadId !== 'string' || !threadId) {
    throw new TypeError('buildSendArgs: threadId required');
  }
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new TypeError('buildSendArgs: body required');
  const out = { threadId, body: text };
  if (typeof recipient === 'string' && recipient) out.toWebid = recipient;
  return out;
}

/**
 * Build the payload for `appealTask`.
 *
 * @param {{taskId: string, body?: string|null}} args
 * @returns {{taskId: string, body?: string}}
 */
export function buildAppealArgs({ taskId, body } = {}) {
  if (typeof taskId !== 'string' || !taskId) {
    throw new TypeError('buildAppealArgs: taskId required');
  }
  const text = typeof body === 'string' ? body.trim() : '';
  return text ? { taskId, body: text } : { taskId };
}

/**
 * Trim a webid for display in the thread header / per-message label.
 * Mirrors mobile's `_short`: keep the last path segment, cap at 14
 * chars + ellipsis. Returns '' for non-strings.
 *
 * @param {string|null|undefined} webid
 * @returns {string}
 */
export function shortWebid(webid) {
  if (typeof webid !== 'string') return '';
  const i = webid.lastIndexOf('/');
  const tail = i >= 0 ? webid.slice(i + 1) : webid;
  return tail.length > 14 ? `${tail.slice(0, 14)}…` : tail;
}

/**
 * Format a chat-message timestamp as `HH:mm` (local time). Returns
 * '' for non-finite values. Mirrors mobile's `_fmtTime`.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatTimestamp(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
