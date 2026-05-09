/**
 * handle — re-export of the lifted handle helpers.
 *
 * Lifted to `@canopy/identity-resolver/display` 2026-05-09 (Phase
 * 41.0.b A1). The substrate carries Stoop's default rules
 * (3..32 chars, `[a-z0-9_-]`); other apps that need different rules
 * pass `{minLen, maxLen, pattern}` to `validateHandle`.
 */
export {
  validateHandle,
  normaliseHandle,
  HANDLE_LIMITS,
} from '@canopy/identity-resolver/display';
