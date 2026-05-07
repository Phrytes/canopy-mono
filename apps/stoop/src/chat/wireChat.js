/**
 * wireChat — thin Stoop shim around `@canopy/chat-p2p`.
 *
 * **2026-05-08:** the implementation lifted into the chat-p2p
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * The shim pre-binds three Stoop-specific knobs:
 *
 *   - `emitEnvelopeType: 'stoop-chat'` — Stoop continues to emit the
 *     legacy envelope type so peers running pre-lift code keep
 *     receiving messages. The substrate (and Tasks V1) emit
 *     `'p2p-chat'`. Both readers accept BOTH types via
 *     `acceptedEnvelopeTypes` so a mixed-version network stays
 *     interoperable.
 *
 *   - `attachmentSupport: { attachmentPath, readAttachmentBytesB64,
 *     maxBytesPerAttachment }` — Phase 39 picture-attachment helpers.
 *     The substrate is generic; Stoop wires its own
 *     `lib/Attachments.js` impls in.
 *
 *   - All other Stoop-specific knobs (`itemStore`, `members`,
 *     `muted`, `evictionRoster`, `dataSource`) pass through verbatim.
 */

import {
  attachmentPath,
  readAttachmentBytesB64,
  MAX_CHAT_BYTES_PER_ATT,
} from '../lib/Attachments.js';
import { wireChat as substrateWireChat } from '@canopy/chat-p2p';

export function wireChat(args) {
  return substrateWireChat({
    ...args,
    emitEnvelopeType:      'stoop-chat',
    acceptedEnvelopeTypes: ['p2p-chat', 'stoop-chat'],
    attachmentSupport: {
      attachmentPath,
      readAttachmentBytesB64,
      maxBytesPerAttachment: MAX_CHAT_BYTES_PER_ATT,
    },
  });
}
