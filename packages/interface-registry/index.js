/**
 * @canopy/interface-registry — per-type renderer registry.
 *
 * Direction-only — Phase 52.12. The Agent slot for this substrate
 * exists in core (Phase 50.13). Hub V2 territory.
 *
 * See `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.12.
 */

export { createInterfaceRegistry } from './src/InterfaceRegistry.js';
export { validateRendererPair }    from './src/renderModes.js';
export { createDefaultPicker }     from './src/defaultPicker.js';
export { permissionDeniedDescriptor } from './src/permissionDenied.js';
