/**
 * @onderling/chat-nav — chat ⇄ side-panel navigation protocol (B.1).
 *
 * Design choice B.1 (per `DESIGN-canopy-chat-journeys.md`): every
 * side-panel page (settings, logs, file-dirs) that the chat shell
 * links to should:
 *
 *   1. Read a `returnTo=<threadId>` query parameter on mount.
 *   2. When present, render a floating "back to chat" button that
 *      navigates back to the originating thread.
 *
 * This substrate ships two tiny helpers:
 *
 *   - `getReturnTo()` / `useReturnToChat()` — read the returnTo
 *     query param (browser environment).  Vanilla JS; the
 *     `useReturnToChat` name aligns with the React-flavoured
 *     consumers that come later.
 *
 *   - `renderFloatingButton(el?, opts)` — emit a fixed-position
 *     button into the DOM; clicking it navigates back to the chat
 *     thread.  Idempotent: re-calling replaces the existing button.
 *
 * Other apps' side-panel pages consume the helpers like this:
 *
 *   import { getReturnTo, renderFloatingButton } from '@onderling/chat-nav';
 *
 *   const ret = getReturnTo();
 *   if (ret) renderFloatingButton(document.body, { returnTo: ret });
 *
 * The chat shell, on the other side, ALWAYS appends
 * `?returnTo=<activeThread.id>` when generating links to side-panel
 * pages — wiring in canopy-chat's web/main.js when those links land.
 */

export { getReturnTo, useReturnToChat, buildChatUrl } from './src/returnTo.js';
export { renderFloatingButton, removeFloatingButton } from './src/floatingButton.js';
