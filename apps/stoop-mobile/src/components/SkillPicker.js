/**
 * SkillPicker — re-export of the lifted substrate component.
 *
 * Lifted to `@canopy/react-native/components` 2026-05-09 (Phase
 * 41.0.b B4). The data-side `localiseField` helper lives at
 * `@canopy/identity-resolver/display`; this file re-exports it
 * via the existing `_localised` alias for back-compat.
 */
export { SkillPicker } from '@canopy/react-native/components';
export { localiseField as _localised } from '@canopy/identity-resolver/display';
