/**
 * Inbound file-share handler.  Bundle H Phase 2 (#269) — lifted from
 * `apps/basis/web/main.js:547`.
 *
 * Renders a file-card embed in the host's main thread with the
 * file's metadata (name, mime, size).  Bytes (base64) stay inside
 * the embed so [Download] / [Save to my pod] can act on them later.
 * No substrate write — folio's `saveToMyPod` happens only on
 * explicit user action.
 *
 * @param {object} args
 * @param {(bubble: object) => void}                args.addMainBubble
 * @param {(event: object) => void}                 [args.publishEvent]
 * @param {{info?, warn?, error?}}                  [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandleFileShare({
  addMainBubble, publishEvent, logger = console,
} = {}) {
  if (typeof addMainBubble !== 'function') throw new Error('makeHandleFileShare: addMainBubble required');

  return function handleFileShare(fromAddr, payload) {
    const f = payload?.file;
    if (!f?.id || !f?.name || !f?.dataB64) {
      logger.warn?.('[peer] file-share missing fields', payload);
      return;
    }
    addMainBubble({
      kind:           'embed-card',
      messageId:      `file-share-${f.id}`,
      threadId:       null,
      lifecycleState: 'live',
      embed: {
        kind:      'file-card',
        appOrigin: 'folio',
        itemRef:   { app: 'folio', type: 'file', id: f.id },
        snapshot:  {
          id:      f.id,
          type:    'file',
          name:    f.name,
          mime:    f.mime ?? 'application/octet-stream',
          bytes:   f.size,
          dataB64: f.dataB64,
          local:   false,
        },
        issuedBy: fromAddr,
      },
    });
    publishEvent?.({
      app:     'folio',
      type:    'notification',
      actor:   fromAddr,
      payload: { message: `📎 file shared: ${f.name} (${_formatBytes(f.size)})` },
    });
  };
}

function _formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  if (n < 1024)         return `${n} B`;
  if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
