/**
 * `acpWriter` — a DIRECT ACP `.acr` writer for real Solid pods that
 * enforce ACP (Inrupt ESS, CSS ≥7 in ACP mode).
 *
 * ── Why this exists (the gap it closes) ─────────────────────────────
 * `@inrupt/solid-client@3.0.0`'s `universalAccess` correctly *detects*
 * ACP but is a **silent no-op** writing the ACR on CSS-ACP. Root cause:
 * a Link-header discovery mismatch — CSS advertises the ACR via
 * `rel="acl"` (target `<resource>.acr`), while Inrupt's `getAcrUrl`
 * looks for `rel="type" acp:AccessControlResource` → returns `null` →
 * falls back to the WAC path (which no-ops on an ACP pod). So the grant
 * lands nowhere and access is never enforced.
 *
 * This writer sidesteps the SDK entirely: it
 *   (a) discovers the ACR URL from the `rel="acl"` Link header (reusing
 *       `capabilities.discoverAcrUrl` — the SAME detection the capability
 *       probe uses; NOT a reimplementation), then
 *   (b) hand-builds a standard `acp:`/`acl:` ACR (the shape PROVEN
 *       against a live CSS 7 ACP pod: unauth read 200, stranger write
 *       403, owner write 205), then
 *   (c) `PUT`s it to the ACR URL with the caller's authenticated fetch.
 *
 * ── SECURITY ────────────────────────────────────────────────────────
 * A mis-written ACR is a real leak (public-read that is secretly
 * public-WRITE, or an owner lock-out). Two guards:
 *   - The turtle is built ONLY from the caller's explicit
 *     `{public, agents}` flags → an acl mode is granted iff the flag is
 *     set. No mode is ever widened.
 *   - The freshly-PUT ACR REPLACES the resource's ACR wholesale (a fresh
 *     resource has none — CSS returns 404 for `<res>.acr` until written).
 *     To avoid locking the owner out of their own resource we ALWAYS
 *     include an owner control policy. That requires knowing the owner's
 *     WebID; without it we REFUSE to write and surface an honest error
 *     rather than risk a lock-out or a policy that omits the owner.
 *
 * Best-effort by contract: never throws into the caller — returns an
 * outcome `{ acrUrl, applied, errors }` mirroring `setResourceAccess`.
 *
 * feat/acp-acr-writer (2026-07-11).
 */

import { discoverAcrUrl } from './capabilities.js';

const ACP_NS = 'http://www.w3.org/ns/solid/acp#';
const ACL_NS = 'http://www.w3.org/ns/auth/acl#';

/** Owner always gets full control so a fresh ACR never locks them out. */
const OWNER_MODES = ['read', 'append', 'write', 'control'];

/** Map an `{read,append,write,control}` flag object → ordered acl mode names. */
function flagsToModes(flags) {
  if (!flags || typeof flags !== 'object') return [];
  const out = [];
  if (flags.read)    out.push('read');
  if (flags.append)  out.push('append');
  if (flags.write)   out.push('write');
  if (flags.control) out.push('control');
  return out;
}

/** acl: term for a mode name (`read` → `acl:Read`). */
function aclTerm(mode) {
  switch (mode) {
    case 'read':    return 'acl:Read';
    case 'append':  return 'acl:Append';
    case 'write':   return 'acl:Write';
    case 'control': return 'acl:Control';
    default:        return null;
  }
}

/** `<...>` iri or a bare acp: term (for `acp:PublicAgent`). */
function agentTerm(webId) {
  return webId === 'PUBLIC' ? 'acp:PublicAgent' : `<${webId}>`;
}

/**
 * Build a standard ACP ACR turtle document granting the given policies.
 * PROVEN shape (probe against live CSS 7 ACP): each `acp:AccessControl`
 * → `acp:apply` an `acp:Policy` (`acp:allow` acl-modes, `acp:anyOf` a
 * matcher) → `acp:Matcher` (`acp:agent` a WebID or `acp:PublicAgent`).
 * The ACR root ties the controls to the resource via `acp:resource` +
 * `acp:accessControl` (+ `acp:memberAccessControl` for a container).
 *
 * @param {object} p
 * @param {string} p.acrUrl
 * @param {string} p.resourceUri
 * @param {Array<{ id: string, agent: string, modes: string[] }>} p.entries
 * @returns {string}
 */
function buildAcrTurtle({ acrUrl, resourceUri, entries }) {
  const acRefs = entries.map((e) => `<${acrUrl}#ac-${e.id}>`).join(', ');
  const lines = [
    `@prefix acp: <${ACP_NS}> .`,
    `@prefix acl: <${ACL_NS}> .`,
    '',
    `<${acrUrl}> a acp:AccessControlResource ;`,
    `  acp:resource <${resourceUri}> ;`,
    `  acp:accessControl ${acRefs} ;`,
    `  acp:memberAccessControl ${acRefs} .`,
    '',
  ];
  for (const e of entries) {
    const allow = e.modes.map(aclTerm).filter(Boolean).join(', ');
    lines.push(
      `<${acrUrl}#ac-${e.id}> a acp:AccessControl ; acp:apply <${acrUrl}#policy-${e.id}> .`,
      `<${acrUrl}#policy-${e.id}> a acp:Policy ; acp:allow ${allow} ; acp:anyOf <${acrUrl}#matcher-${e.id}> .`,
      `<${acrUrl}#matcher-${e.id}> a acp:Matcher ; acp:agent ${agentTerm(e.agent)} .`,
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Write an ACP ACR enforcing `{public, agents}` (+ implicit owner
 * control) on a single resource. Best-effort: never throws — returns
 * `{ acrUrl, applied, errors }` in the same subject shape
 * `setResourceAccess` reports.
 *
 * @param {object} opts
 * @param {typeof fetch} opts.fetch       — authenticated fetch
 * @param {string} opts.resourceUri
 * @param {string} opts.ownerWebId        — REQUIRED (owner control; no lock-out)
 * @param {{read?,append?,write?,control?}} [opts.public]  — unauthenticated access
 * @param {Record<string,{read?,append?,write?,control?}>} [opts.agents]
 * @returns {Promise<{
 *   acrUrl: string|null,
 *   applied: Array<{subject:'public'|'agent', agent?:string, modes:string[]}>,
 *   errors:  Array<{subject:'public'|'agent', agent?:string, code?:string, message:string}>,
 * }>}
 */
export async function writeAcpAcr({ fetch: authFetch, resourceUri, ownerWebId, public: pub, agents } = {}) {
  // The requested (caller-visible) grants — what lands in `applied`/`errors`.
  const requested = [];
  const publicModes = flagsToModes(pub);
  if (publicModes.length > 0) requested.push({ subject: 'public', modes: publicModes });
  if (agents && typeof agents === 'object') {
    for (const [webId, flags] of Object.entries(agents)) {
      const modes = flagsToModes(flags);
      if (modes.length > 0) requested.push({ subject: 'agent', agent: webId, modes });
    }
  }

  // Nothing to do → clean no-op (don't clobber an existing ACR).
  if (requested.length === 0) return { acrUrl: null, applied: [], errors: [] };

  const fail = (code, message) => ({
    acrUrl: null,
    applied: [],
    errors: requested.map((r) => ({
      subject: r.subject, ...(r.agent ? { agent: r.agent } : {}), code, message,
    })),
  });

  if (typeof authFetch !== 'function') {
    return fail('ACP_WRITE_FAILED', 'acpWriter: authenticated fetch is required');
  }
  // Owner control is mandatory — refuse to write an ACR that could lock
  // the owner out of their own resource.
  if (typeof ownerWebId !== 'string' || ownerWebId.length === 0) {
    return fail('ACP_OWNER_UNKNOWN',
      'acpWriter: owner WebID unknown — refusing to write an ACR without an owner-control policy (lock-out guard)');
  }

  // Discover the ACR URL (reuse capabilities.js detection).
  let acrUrl;
  try {
    acrUrl = await discoverAcrUrl(resourceUri, authFetch);
  } catch (err) {
    return fail('ACP_ACR_DISCOVERY_FAILED', `acpWriter: ACR discovery failed for "${resourceUri}": ${err?.message ?? err}`);
  }
  if (!acrUrl) {
    return fail('ACP_ACR_NOT_ADVERTISED', `acpWriter: no ACR advertised for "${resourceUri}" (not an ACP resource?)`);
  }

  // Compose the ACR: owner control (structural) + the requested grants.
  const entries = [{ id: 'owner', agent: ownerWebId, modes: OWNER_MODES }];
  let publicUsed = false;
  let agentIdx = 0;
  for (const r of requested) {
    if (r.subject === 'public') { entries.push({ id: 'public', agent: 'PUBLIC', modes: r.modes }); publicUsed = true; }
    else entries.push({ id: `agent-${agentIdx++}`, agent: r.agent, modes: r.modes });
  }
  void publicUsed;

  const turtle = buildAcrTurtle({ acrUrl, resourceUri, entries });

  let res;
  try {
    res = await authFetch(acrUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/turtle' },
      body: turtle,
    });
  } catch (err) {
    return fail('ACP_WRITE_FAILED', `acpWriter: PUT ACR failed for "${acrUrl}": ${err?.message ?? err}`);
  }
  if (!res || !res.ok) {
    let detail = '';
    try { detail = res ? `${res.status} ${(await res.text?.()) ?? ''}`.trim() : 'no response'; } catch { detail = String(res?.status ?? '?'); }
    return {
      acrUrl,
      applied: [],
      errors: requested.map((r) => ({
        subject: r.subject, ...(r.agent ? { agent: r.agent } : {}),
        code: 'ACP_WRITE_REJECTED', message: `acpWriter: server rejected ACR PUT (${detail})`,
      })),
    };
  }

  // Success — every requested grant landed in the ACR.
  return {
    acrUrl,
    applied: requested.map((r) => ({
      subject: r.subject, ...(r.agent ? { agent: r.agent } : {}), modes: r.modes,
    })),
    errors: [],
  };
}
