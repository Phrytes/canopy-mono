/**
 * createInterfaceRegistry — the substrate factory.
 *
 * Apps register `{type, bundleId, renderer, actions}` pairs;
 * consumers call `lookup(type)` or `renderCompact / renderFull` to
 * project an item through the right renderer.
 *
 * Conflict resolution: multiple bundles can register the same type
 * (e.g. two Tasks-shaped apps). The substrate records all
 * registrations; the default-picker decides which one fires.
 *
 * Standardisation Phase 52.12.
 */

import { validateRendererPair }       from './renderModes.js';
import { createDefaultPicker }        from './defaultPicker.js';
import { permissionDeniedDescriptor } from './permissionDenied.js';

/**
 * @param {object} [opts]
 * @param {(type: string) => boolean} [opts.allowType] — gate registrations to a vocabulary
 */
export function createInterfaceRegistry(opts = {}) {
  /** @type {Map<string, Map<string, import('./renderModes.js').RegistrationEntry>>} */
  const byType = new Map();
  const picker = createDefaultPicker();
  const subscribers = new Set();

  function _fanOut(event) {
    for (const cb of subscribers) { try { cb(event); } catch { /* swallow */ } }
  }

  /**
   * Register a renderer for a type. Re-registering the same
   * `(type, bundleId)` pair replaces the prior entry.
   */
  function register({ type, bundleId, renderer, actions } = {}) {
    if (typeof type !== 'string' || type.length === 0) {
      throw Object.assign(
        new Error('register: type is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof bundleId !== 'string' || bundleId.length === 0) {
      throw Object.assign(
        new Error('register: bundleId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof opts.allowType === 'function' && !opts.allowType(type)) {
      throw Object.assign(
        new Error(`register: type "${type}" rejected by allowType`),
        { code: 'TYPE_NOT_ALLOWED' },
      );
    }
    validateRendererPair(renderer);

    const entry = Object.freeze({
      type,
      bundleId,
      renderer:     Object.freeze(renderer),
      actions:      Array.isArray(actions) ? Object.freeze([...actions]) : Object.freeze([]),
      registeredAt: new Date().toISOString(),
    });
    let perBundle = byType.get(type);
    if (!perBundle) {
      perBundle = new Map();
      byType.set(type, perBundle);
    }
    perBundle.set(bundleId, entry);

    // First-write-wins default — establishes a default for single-
    // bundle installs without forcing a setDefault call.
    if (picker.getDefault(type) === null) picker.setDefault(type, bundleId);

    _fanOut({ op: 'register', type, bundleId });
    return entry;
  }

  /**
   * Unregister a bundle's entry for a type. Idempotent.
   */
  function unregister({ type, bundleId } = {}) {
    const perBundle = byType.get(type);
    if (!perBundle) return;
    const had = perBundle.delete(bundleId);
    if (!had) return;
    if (perBundle.size === 0) byType.delete(type);
    if (picker.getDefault(type) === bundleId) {
      // Promote any remaining sibling to default; else clear.
      const next = perBundle.size > 0 ? [...perBundle.keys()][0] : null;
      if (next) picker.setDefault(type, next);
      else      picker.clearDefault(type);
    }
    _fanOut({ op: 'unregister', type, bundleId });
  }

  /**
   * Look up the active renderer for a type — honours the default
   * picker. Returns the entry plus the conflicting siblings (so the
   * UI can surface a "pick default" prompt when more than one is
   * present).
   *
   * @returns {{
   *   entry: import('./renderModes.js').RegistrationEntry | null,
   *   conflicts: import('./renderModes.js').RegistrationEntry[],
   * }}
   */
  function lookup(type) {
    const perBundle = byType.get(type);
    if (!perBundle || perBundle.size === 0) return { entry: null, conflicts: [] };
    const defaultBundle = picker.getDefault(type);
    let entry = defaultBundle ? perBundle.get(defaultBundle) ?? null : null;
    if (!entry) entry = perBundle.values().next().value ?? null;
    const conflicts = [];
    for (const e of perBundle.values()) {
      if (e !== entry) conflicts.push(e);
    }
    return { entry, conflicts };
  }

  /**
   * Project an item through the type's compact renderer. Returns
   * the renderer's output directly; on miss returns a
   * permission-denied descriptor so callers can render a fallback
   * chip without branching.
   */
  function renderCompact(item, ctx) {
    return _render('compact', item, ctx);
  }

  function renderFull(item, ctx) {
    return _render('full', item, ctx);
  }

  function _render(mode, item, ctx) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') {
      return permissionDeniedDescriptor({
        type:   'unknown',
        ref:    ctx?.ref ?? '',
        reason: 'BAD_INPUT',
      });
    }
    const { entry } = lookup(item.type);
    if (!entry) {
      return permissionDeniedDescriptor({
        type:   item.type,
        ref:    ctx?.ref ?? item.id ?? '',
        reason: 'NO_RENDERER',
      });
    }
    try {
      return entry.renderer[mode](item, ctx);
    } catch (err) {
      return permissionDeniedDescriptor({
        type:   item.type,
        ref:    ctx?.ref ?? item.id ?? '',
        reason: err?.code ?? 'RENDER_ERROR',
      });
    }
  }

  /**
   * Subscribe to registration changes. Useful for UI shells that
   * surface installed-bundle pickers.
   */
  function subscribe(cb) {
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribe: cb must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }

  function listTypes() {
    return [...byType.keys()].sort();
  }

  function listBundles(type) {
    const perBundle = byType.get(type);
    return perBundle ? [...perBundle.values()] : [];
  }

  return {
    register,
    unregister,
    lookup,
    renderCompact,
    renderFull,
    subscribe,
    listTypes,
    listBundles,

    setDefault:   (type, bundleId) => picker.setDefault(type, bundleId),
    clearDefault: (type) => picker.clearDefault(type),
    getDefault:   (type) => picker.getDefault(type),
    getDefaults:  () => picker.getAll(),
  };
}
