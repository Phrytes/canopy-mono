// Added feedback bots (cluster J) — feedback is reached as a REAL added bot: the user adds it via the
// portal **invite link/QR** (`?projectId=…&code=…`), NOT pre-seeded. The feedback bot is co-hosted (not a
// PeerGraph peer), so it gets its own small persisted registry, merged into the Contacten roster; tapping
// it opens the dedicated feedback thread + activates the verify pods. Pure + storage-injected so it's
// shared web≡mobile (localStorage on web, AsyncStorage on mobile — the async API covers both).

import { parseFeedbackInvite } from '../feedback/feedbackSurface.js';

const KEY = 'cc.feedbackBots';

/** Stable contact id for a project's feedback bot. */
export const feedbackBotId = (projectId) => `fp-bot:${projectId}`;

/**
 * Parse an add-a-bot input (a feedback invite URL / query string / pasted link) into a feedback-bot
 * descriptor, or null when it isn't a feedback invite.
 * @returns {{id, kind, label, projectId, code, activationUrl?}|null}
 */
export function feedbackBotFromInput(input, { activationUrl, collectorUrl, label } = {}) {
  const invite = parseFeedbackInvite(input);
  if (!invite) return null;
  return {
    id: feedbackBotId(invite.projectId),
    kind: 'agent',
    contactId: feedbackBotId(invite.projectId),
    name: label || `Feedback · ${invite.projectId}`,
    label: label || `Feedback · ${invite.projectId}`,
    projectId: invite.projectId,
    code: invite.code,
    // A bot with an `activationUrl` uses the login/activation flow; one with a `collectorUrl` (and no
    // activation) uses the NO-LOGIN collector flow — raw stays local, the signed summary goes to the
    // collector. Mutually exclusive in practice; FeedbackThreadScreen branches on which is present.
    ...(activationUrl ? { activationUrl } : {}),
    ...(collectorUrl ? { collectorUrl } : {}),
  };
}

/**
 * A persisted registry of added feedback bots. `storage` is any `{getItem,setItem}` (localStorage on web,
 * AsyncStorage on mobile); all methods are async so the same code serves both.
 */
export function createFeedbackBotStore(storage) {
  const read = async () => { try { return JSON.parse((await storage.getItem(KEY)) || '[]'); } catch { return []; } };
  const write = async (list) => { try { await storage.setItem(KEY, JSON.stringify(list)); } catch { /* quota/disabled */ } };
  return {
    async list() { return read(); },
    async add(bot) { const l = (await read()).filter((b) => b.id !== bot.id); l.push(bot); await write(l); return bot; },
    async remove(id) { await write((await read()).filter((b) => b.id !== id)); },
    async get(id) { return (await read()).find((b) => b.id === id) || null; },
  };
}
