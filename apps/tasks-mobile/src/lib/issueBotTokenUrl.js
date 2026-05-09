/**
 * issueBotTokenUrl — encode a V1.5 bot cap-token into a
 * `tasks://bot-token?chatId=&webid=&tokenBlob=` URL the
 * BotBindings classifier (Phase 41.3 qrClassifiers) decodes.
 *
 * Phase 41.13 (2026-05-09).
 *
 * Pure-JS so the encoder + decoder round-trip can be unit-tested
 * outside the React tree.
 */

/**
 * @param {object} args
 * @param {string} args.chatId       Telegram chatId or arbitrary id
 * @param {string} args.webid        the binding's actingAs webid
 * @param {string} args.tokenBlob    the cap-token serialised string
 * @returns {string}                 `tasks://bot-token?...`
 */
export function encodeIssueBotTokenUrl({ chatId, webid, tokenBlob } = {}) {
  if (typeof chatId !== 'string' || !chatId) {
    throw new TypeError('encodeIssueBotTokenUrl: chatId required');
  }
  if (typeof webid !== 'string' || !webid) {
    throw new TypeError('encodeIssueBotTokenUrl: webid required');
  }
  if (typeof tokenBlob !== 'string' || !tokenBlob) {
    throw new TypeError('encodeIssueBotTokenUrl: tokenBlob required');
  }
  const qs = `chatId=${encodeURIComponent(chatId)}` +
             `&webid=${encodeURIComponent(webid)}` +
             `&tokenBlob=${encodeURIComponent(tokenBlob)}`;
  return `tasks://bot-token?${qs}`;
}
