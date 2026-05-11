/**
 * Default permission-denied rendering — the fallback chip a
 * consumer renders when an embedded ref points to a cross-pod
 * resource the receiver can't fetch (ACP-blocked, network-flake,
 * resource gone).
 *
 * Substrate ships a renderer-agnostic descriptor; the platform
 * layer (RN, web, CLI) translates it to its native renderable.
 *
 * Standardisation Phase 52.12.5.
 *
 * @typedef {object} PermissionDeniedDescriptor
 * @property {'permission-denied'} kind
 * @property {string} type      — the requested item type (for context)
 * @property {string} ref       — the unreachable URI
 * @property {string} [reason]  — short tag ('NOT_FOUND', 'FORBIDDEN', 'NETWORK_ERROR')
 * @property {string} [label]   — human-readable string the UI can show
 */

/**
 * Build a default permission-denied descriptor.
 *
 * @param {object} args
 * @param {string} args.type
 * @param {string} args.ref
 * @param {string} [args.reason]
 * @returns {PermissionDeniedDescriptor}
 */
export function permissionDeniedDescriptor({ type, ref, reason } = {}) {
  if (typeof type !== 'string' || type.length === 0) {
    throw Object.assign(
      new Error('permissionDeniedDescriptor: type is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  // `ref` is optional — internal renderer fallbacks may lack a URI
  // (BAD_INPUT case where there's no item to derive one from).
  const normRef = typeof ref === 'string' && ref.length > 0 ? ref : null;
  return Object.freeze({
    kind:   'permission-denied',
    type,
    ref:    normRef,
    ...(reason ? { reason } : {}),
    label:  _defaultLabel({ type, reason }),
  });
}

function _defaultLabel({ type, reason }) {
  if (reason === 'FORBIDDEN')      return `🔒 ${type} (access denied)`;
  if (reason === 'NOT_FOUND')      return `❌ ${type} (not found)`;
  if (reason === 'NETWORK_ERROR')  return `⚠️ ${type} (unavailable)`;
  return `🔒 ${type}`;
}
