/**
 * TelegramBridge — re-exported from @onderling/chat-agent (L1c).
 *
 * As of 2026-05-02 (Plan B sub-task B.5) the implementation moved
 * into the substrate so any future chat-agent consumer (H2 V2, H5,
 * etc.) gets the validated telegraf-backed bridge for free.  Existing
 * import sites (`from '../bridges/TelegramBridge.js'`) continue to
 * work via this shim.  Closes the long-standing Task #12.
 *
 * The substrate's TelegramBridge is identical to this file's prior
 * version (addressed-only filter, button-tap synthesis, webhook +
 * long-polling, graceful shutdown).  See
 * packages/chat-agent/src/bridges/TelegramBridge.js for the
 * canonical implementation.
 */

export { TelegramBridge } from '@onderling/chat-agent/bridges/telegram';
