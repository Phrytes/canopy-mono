/**
 * `client.sharing.*` — Phase 52.16 (2026-05-14).
 *
 * ACP/WAC-mediated sharing for resources hosted on real Solid pods.
 * Uses `@inrupt/solid-client`'s Universal Access API which abstracts
 * over ACP (Inrupt v2+) and WAC (CSS, NSS legacy, older Inrupt) so
 * both server flavours work through one surface.
 *
 * **Auth.** The factory accepts the authenticated `fetch` from the
 * parent `PodClient`. All requests inherit that fetch.
 *
 * **Lazy SDK load.** `@inrupt/solid-client` is dynamic-imported on
 * first use so pod-client consumers that never call sharing don't pay
 * the bundle cost. If the SDK isn't installed, `grant/revoke/list`
 * throw a clear error.
 *
 * **Mode contract.** Modes are the four standard Solid access
 * primitives: `'read'`, `'append'`, `'write'`, `'control'`. The
 * latter is the only mode that touches the ACL/ACR itself (admin).
 *
 * **What's NOT implemented in V1:**
 *   - Group grants (`{group: 'https://...#group', modes}`). ACP
 *     supports them; WAC has a legacy form. Defer until a real
 *     consumer needs them.
 *   - Bulk grants over a container hierarchy with ACR inheritance.
 *     The container-level grant works because Solid servers honour
 *     `acp:apply` / `acp:applyMembers`; container-recursive policies
 *     are server-specific.
 *
 * @typedef {'read' | 'append' | 'write' | 'control'} ShareMode
 * @typedef {import('../Errors.js').SharingUnsupportedError} SharingUnsupportedError
 */

import { SharingUnsupportedError, PodClientError } from '../Errors.js';
import { probeCapabilities } from './capabilities.js';

/* ── Lazy load of @inrupt/solid-client ──────────────────────────── */

let _inrupt = null;
async function loadInrupt() {
  if (_inrupt) return _inrupt;
  try {
    _inrupt = await import('@inrupt/solid-client');
  } catch (err) {
    throw new PodClientError(
      'client.sharing: @inrupt/solid-client is not installed — add it as a dependency to use ACP/WAC sharing',
      { code: 'SHARING_SDK_MISSING', cause: err },
    );
  }
  return _inrupt;
}

// Test-only seam — let tests inject a fake Inrupt module without
// stubbing `import.meta`. Match the pattern of other `_set...Factory`
// helpers in the substrate.
export function _setInruptModuleForTests(mod) {
  _inrupt = mod;
}

/* ── Mode mapping ───────────────────────────────────────────────── */

/**
 * Map our mode strings to the Universal Access `Access` object.
 *
 * - `read`    → `{ read: true }`
 * - `append`  → `{ append: true }`
 * - `write`   → `{ write: true }`
 * - `control` → `{ controlRead: true, controlWrite: true }`
 *
 * The Universal Access API requires the FULL object on each call (no
 * "merge"). So we always build the complete shape from the modes
 * array — `true` for selected modes, `false` for the rest.
 *
 * @param {ShareMode[]} modes
 */
function modesToAccess(modes) {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new PodClientError(
      'client.sharing: at least one mode is required',
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const out = { read: false, append: false, write: false, controlRead: false, controlWrite: false };
  for (const m of modes) {
    switch (m) {
      case 'read':    out.read = true; break;
      case 'append':  out.append = true; break;
      case 'write':   out.write = true; break;
      case 'control': out.controlRead = true; out.controlWrite = true; break;
      default:
        throw new PodClientError(
          `client.sharing: unknown mode "${m}" — expected one of read|append|write|control`,
          { code: 'INVALID_ARGUMENT' },
        );
    }
  }
  return out;
}

/**
 * Inverse — turn an Universal Access `Access` object back into a
 * modes array (sorted alphabetically for stable test output).
 */
function accessToModes(access) {
  const modes = [];
  if (access?.read)   modes.push('read');
  if (access?.append) modes.push('append');
  if (access?.write)  modes.push('write');
  if (access?.controlRead || access?.controlWrite) modes.push('control');
  modes.sort();
  return modes;
}

/* ── Capability cache ───────────────────────────────────────────── */

/**
 * Per-pod-origin capabilities cache. We probe once per origin and
 * reuse the result for the lifetime of the sharing instance —
 * capabilities don't change between requests within a session.
 */
function makeCapabilitiesCache() {
  const byOrigin = new Map();
  return {
    async get(uri, fetchFn) {
      const origin = _originOf(uri);
      if (!origin) {
        throw new PodClientError(
          `client.sharing: cannot parse origin of "${uri}"`,
          { code: 'INVALID_ARGUMENT', uri },
        );
      }
      if (byOrigin.has(origin)) return byOrigin.get(origin);
      const caps = await probeCapabilities(uri, fetchFn);
      byOrigin.set(origin, caps);
      return caps;
    },
    /** Test seam — pre-seed the cache. */
    _set(origin, caps) { byOrigin.set(origin, caps); },
    /** Force a re-probe on next call. */
    invalidate(uri) {
      const origin = _originOf(uri);
      if (origin) byOrigin.delete(origin);
    },
  };
}

function _originOf(uri) {
  try { return new URL(uri).origin; } catch { return null; }
}

/* ── Public factory ─────────────────────────────────────────────── */

/**
 * Build a `client.sharing` namespace. Called lazily by
 * `PodClient.sharing` (only once per client). The returned object is
 * the public sharing surface.
 *
 * @param {object} opts
 * @param {typeof fetch} opts.fetch      — authenticated fetch from the parent PodClient
 * @param {string}       opts.podRoot    — pod root URI (for context / error messages)
 */
export function createClientSharing({ fetch: authFetch, podRoot } = {}) {
  if (typeof authFetch !== 'function') {
    throw new PodClientError(
      'createClientSharing: fetch is required',
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const capsCache = makeCapabilitiesCache();

  /* ── Sub-helpers ─────────────────────────────────────────────── */

  async function _resolveTarget(opts) {
    if (typeof opts?.resourceUri === 'string' && opts.resourceUri.length > 0) {
      return { targetUri: opts.resourceUri, kind: 'resource' };
    }
    if (typeof opts?.containerUri === 'string' && opts.containerUri.length > 0) {
      const c = opts.containerUri.endsWith('/') ? opts.containerUri : `${opts.containerUri}/`;
      return { targetUri: c, kind: 'container' };
    }
    throw new PodClientError(
      'client.sharing: one of {resourceUri, containerUri} is required',
      { code: 'INVALID_ARGUMENT' },
    );
  }

  async function _requireSharingSupported(targetUri) {
    const caps = await capsCache.get(targetUri, authFetch);
    if (!caps.acp && !caps.wac) {
      throw new SharingUnsupportedError(
        `client.sharing: pod at "${_originOf(targetUri)}" does not expose ACP or WAC — cannot mediate sharing`,
        { uri: targetUri },
      );
    }
    return caps;
  }

  function _resolveSubject(opts) {
    // Exactly one of agent / public must be supplied (group is V1-deferred).
    const hasAgent  = typeof opts?.agent === 'string' && opts.agent.length > 0;
    const isPublic  = opts?.public === true;
    const hasGroup  = typeof opts?.group === 'string' && opts.group.length > 0;
    if (hasGroup) {
      throw new PodClientError(
        'client.sharing: group grants are not implemented in V1 — pin a real consumer + revisit',
        { code: 'NOT_IMPLEMENTED' },
      );
    }
    if (hasAgent && isPublic) {
      throw new PodClientError(
        'client.sharing: pass exactly one of {agent, public:true}',
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!hasAgent && !isPublic) {
      throw new PodClientError(
        'client.sharing: one of {agent, public:true} is required',
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return { subject: isPublic ? 'public' : 'agent', agent: hasAgent ? opts.agent : null };
  }

  /* ── Public methods ──────────────────────────────────────────── */

  /**
   * Probe the target's capabilities. Cached per-origin within the
   * client. Useful for apps that want to choose between ACP grants
   * and cap-token issuance up front.
   *
   * @param {object} opts
   * @param {string} [opts.resourceUri]
   * @param {string} [opts.containerUri]
   * @returns {Promise<{acp: boolean, wac: boolean}>}
   */
  async function capabilities(opts = {}) {
    const { targetUri } = await _resolveTarget(opts);
    return capsCache.get(targetUri, authFetch);
  }

  /**
   * Grant access on a resource or container.
   *
   * @param {object} opts
   * @param {string} [opts.resourceUri]
   * @param {string} [opts.containerUri]
   * @param {string} [opts.agent]
   * @param {boolean} [opts.public]
   * @param {ShareMode[]} opts.modes
   * @returns {Promise<{
   *   targetUri: string,
   *   kind: 'resource'|'container',
   *   subject: 'agent'|'public',
   *   agent?: string,
   *   modes: ShareMode[],
   *   mode: 'acp'|'wac',
   * }>}
   */
  async function grant(opts = {}) {
    const { targetUri, kind } = await _resolveTarget(opts);
    const caps = await _requireSharingSupported(targetUri);
    const { subject, agent } = _resolveSubject(opts);
    const access = modesToAccess(opts.modes);
    const sdkMode = caps.acp ? 'acp' : 'wac';

    const inrupt = await loadInrupt();
    const setter = subject === 'public'
      ? inrupt.universalAccess?.setPublicAccess
      : inrupt.universalAccess?.setAgentAccess;
    if (typeof setter !== 'function') {
      throw new PodClientError(
        'client.sharing: @inrupt/solid-client does not expose universalAccess — Inrupt SDK v2+ required',
        { code: 'SHARING_SDK_TOO_OLD' },
      );
    }

    let applied;
    try {
      applied = subject === 'public'
        ? await setter(targetUri, access, { fetch: authFetch })
        : await setter(targetUri, agent, access, { fetch: authFetch });
    } catch (err) {
      throw new PodClientError(
        `client.sharing.grant: failed for "${targetUri}": ${err?.message ?? err}`,
        { code: 'SHARING_GRANT_FAILED', uri: targetUri, cause: err },
      );
    }
    // Inrupt `universalAccess.set*Access` returns the resulting Access
    // object on success and `null` when it could not apply the change.
    // Verified 2026-05-16: against CSS 7.1.9 ACP, @inrupt/solid-client
    // 3.0.0 is a SILENT NO-OP here (returns null, never writes the
    // `.acr`). Treating that as success tells the caller a grant landed
    // when nothing did — surface it instead of papering over.
    if (applied == null) {
      throw new PodClientError(
        `client.sharing.grant: the access SDK applied no change for "${targetUri}" `
        + '(server/SDK incompatibility — e.g. @inrupt/solid-client vs this server\'s ACP)',
        { code: 'SHARING_GRANT_NOOP', uri: targetUri },
      );
    }

    return {
      targetUri,
      kind,
      subject,
      ...(agent ? { agent } : {}),
      modes: accessToModes(access),
      mode:  sdkMode,
    };
  }

  /**
   * Revoke an existing grant. Pass the same `{agent | public}` shape
   * that was used to grant. Internally this sets all modes to false.
   *
   * @param {object} opts
   * @param {string} [opts.resourceUri]
   * @param {string} [opts.containerUri]
   * @param {string} [opts.agent]
   * @param {boolean} [opts.public]
   */
  async function revoke(opts = {}) {
    const { targetUri, kind } = await _resolveTarget(opts);
    const caps = await _requireSharingSupported(targetUri);
    const { subject, agent } = _resolveSubject(opts);
    const sdkMode = caps.acp ? 'acp' : 'wac';

    const inrupt = await loadInrupt();
    const setter = subject === 'public'
      ? inrupt.universalAccess?.setPublicAccess
      : inrupt.universalAccess?.setAgentAccess;
    if (typeof setter !== 'function') {
      throw new PodClientError(
        'client.sharing: @inrupt/solid-client does not expose universalAccess',
        { code: 'SHARING_SDK_TOO_OLD' },
      );
    }

    const noAccess = { read: false, append: false, write: false, controlRead: false, controlWrite: false };
    let applied;
    try {
      applied = subject === 'public'
        ? await setter(targetUri, noAccess, { fetch: authFetch })
        : await setter(targetUri, agent, noAccess, { fetch: authFetch });
    } catch (err) {
      throw new PodClientError(
        `client.sharing.revoke: failed for "${targetUri}": ${err?.message ?? err}`,
        { code: 'SHARING_REVOKE_FAILED', uri: targetUri, cause: err },
      );
    }
    // Same as grant: `null` ⇒ the SDK applied nothing (silent no-op,
    // e.g. @inrupt/solid-client 3.0.0 vs CSS 7.1.9 ACP). Don't report a
    // revoke that didn't happen.
    if (applied == null) {
      throw new PodClientError(
        `client.sharing.revoke: the access SDK applied no change for "${targetUri}" `
        + '(server/SDK incompatibility — e.g. @inrupt/solid-client vs this server\'s ACP)',
        { code: 'SHARING_REVOKE_NOOP', uri: targetUri },
      );
    }

    return {
      targetUri,
      kind,
      subject,
      ...(agent ? { agent } : {}),
      mode: sdkMode,
    };
  }

  /**
   * List active grants on a resource or container. Returns one entry
   * per agent (plus an optional public entry).
   *
   * @param {object} opts
   * @param {string} [opts.resourceUri]
   * @param {string} [opts.containerUri]
   * @returns {Promise<Array<{
   *   subject: 'agent'|'public',
   *   agent?: string,
   *   modes: ShareMode[],
   * }>>}
   */
  async function list(opts = {}) {
    const { targetUri } = await _resolveTarget(opts);
    await _requireSharingSupported(targetUri);

    const inrupt = await loadInrupt();
    const ua = inrupt.universalAccess;
    if (!ua) {
      throw new PodClientError(
        'client.sharing.list: @inrupt/solid-client does not expose universalAccess',
        { code: 'SHARING_SDK_TOO_OLD' },
      );
    }

    const out = [];

    // Public access — single record (if any modes set).
    try {
      if (typeof ua.getPublicAccess === 'function') {
        const publicAccess = await ua.getPublicAccess(targetUri, { fetch: authFetch });
        const modes = accessToModes(publicAccess);
        if (modes.length > 0) out.push({ subject: 'public', modes });
      }
    } catch (err) {
      // Skip on probe error; don't fail the whole list.
    }

    // Per-agent access — only callable when we know who to ask. The
    // SDK doesn't expose a "list all agents" call against arbitrary
    // pods; callers passing `agentsToQuery` get those queried.
    if (Array.isArray(opts.agentsToQuery) && opts.agentsToQuery.length > 0) {
      if (typeof ua.getAgentAccess === 'function') {
        for (const agent of opts.agentsToQuery) {
          try {
            const agentAccess = await ua.getAgentAccess(targetUri, agent, { fetch: authFetch });
            const modes = accessToModes(agentAccess);
            if (modes.length > 0) out.push({ subject: 'agent', agent, modes });
          } catch { /* swallow per-agent */ }
        }
      }
    }

    return out;
  }

  return {
    capabilities,
    grant,
    revoke,
    list,

    // Test seams
    _capsCache: capsCache,
  };
}
