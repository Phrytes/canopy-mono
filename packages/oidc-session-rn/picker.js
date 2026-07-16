/**
 * `@onderling/oidc-session-rn/picker` subpath.
 *
 * Pulls `react-native` at module load — kept separate from the root
 * barrel so non-RN consumers (test runners, server-side helpers)
 * don't have to satisfy the dep.
 *
 * Phase 52.15.5 (2026-05-14).
 */

export { IssuerPicker } from './src/picker/IssuerPicker.js';
