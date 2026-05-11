/**
 * @canopy/react-native/hub-binding — promise-based wrapper around the
 * Hub AIDL binder.
 *
 * V0 ships (Phase 51.7–51.9):
 *   - `bind({nativeModule, manifest, intentAction?, clientVersions?})` →
 *     returns an `IHubBinding` once the service connects + version
 *     negotiation succeeds.
 *   - `IHubBinding` exposes promise-based methods for every AIDL call
 *     (fetchResource / writeResource / publishEnvelope / declareCapabilities,
 *     plus V2-only registerInterface / lookupInterface / orchestrateProtocol).
 *   - `negotiateVersion({clientVersions, hubVersions})` is exported for
 *     callers that want to introspect the picker.
 *
 * Real native bridge lives in `android/.../HubBindingModule.kt` (see
 * `HUB-BINDING-BUILD.md`). Tests pass mock bridges.
 *
 * Standardisation Phase 51.8 + 51.9.
 */

export { bind, DEFAULT_INTENT_ACTION, DEFAULT_CLIENT_VERSIONS } from './bind.js';
export { IHubBinding }      from './IHubBinding.js';
export { negotiateVersion } from './versionNegotiation.js';
