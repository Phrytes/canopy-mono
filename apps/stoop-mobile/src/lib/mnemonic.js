/**
 * Re-export of the lifted mnemonic pure-fn helpers.
 *
 * Lifted to `@onderling/react-native/mnemonic` 2026-05-09 (Phase 41.0
 * L5). Stoop-mobile keeps this file as a re-export so existing imports
 * (`import { statusFor } from '../lib/mnemonic.js'`) keep working.
 *
 * The new substrate-level UI (useMnemonicReveal hook + MnemonicView
 * component) is available at `@onderling/react-native/mnemonic` /
 * `@onderling/react-native/mnemonic/view`. Stoop's existing screens
 * keep using their own UI; the substrate UI is pre-built for
 * Tasks-mobile.
 */
export {
  BIP39_WORD_COUNTS,
  normaliseMnemonic,
  mnemonicWords,
  hasValidWordCount,
  looksLikeMnemonic,
  statusFor,
} from '@onderling/react-native/mnemonic';
