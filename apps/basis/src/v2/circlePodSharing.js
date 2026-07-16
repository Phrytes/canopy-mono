/**
 * circlePodSharing — a real (not no-op) ACL `sharing` for the per-circle pod
 * producer, writing Solid **ACP** Access Control Resources (`.acr`) directly over
 * the owner's authenticated fetch. No Inrupt SDK dependency (the pod-client's
 * `createClientSharing` needs `@inrupt/solid-client` + has a documented silent
 * no-op against CSS+ACP). ACP is the default access model on modern CSS (the
 * control resource is `<container>.acr`, advertised via the `rel="acl"` Link).
 *
 * Implements the `{ grant, revoke }` shape `controlAgent` calls:
 *   grant({ containerUri, agent, modes })  · revoke({ containerUri, agent, modes })
 *
 * It writes ONE `.acr` per granted container with: the OWNER's full control + an
 * `acl:Read` (or read+write) policy per member webid, applied to the container AND
 * (via `acp:memberAccessControl`) every resource it contains — so a member,
 * authenticated as THEMSELVES, can read the shared circle pod from their own device.
 * Members only ever see CIPHERTEXT (the group key is per-recipient wrapped; content
 * is sealed), so a shared read grant is safe.
 *
 * Used on real-pod (signed-in) circles; the in-memory pseudo-pod keeps the no-op.
 */

const ACP = 'http://www.w3.org/ns/solid/acp#';
const ACL = 'http://www.w3.org/ns/auth/acl#';

/** modes[] → acl:mode list (read → acl:Read, write → acl:Write+Append, control → acl:Control). */
function aclModes(modes = ['read']) {
  const set = new Set();
  for (const m of modes) {
    if (m === 'read') set.add('acl:Read');
    else if (m === 'write') { set.add('acl:Write'); set.add('acl:Append'); }
    else if (m === 'control') { set.add('acl:Read'); set.add('acl:Write'); set.add('acl:Control'); }
  }
  if (!set.size) set.add('acl:Read');
  return [...set].join(', ');
}

/** `<container>/` → `<container>/.acr` (the control resource CSS advertises via rel="acl"). */
function acrUriFor(containerUri) {
  return `${containerUri.endsWith('/') ? containerUri : `${containerUri}/`}.acr`;
}

/**
 * @param {object} a
 * @param {(url:string, init?:object)=>Promise<Response>} a.fetch  the OWNER's authenticated fetch (has Control)
 * @param {string} a.ownerWebId  the circle owner's webid (keeps full control in every .acr)
 * @param {{info?,warn?,error?}} [a.logger]
 * @returns {{ grant:Function, revoke:Function }}
 */
export function createCirclePodSharing({ fetch, ownerWebId, logger = console } = {}) {
  if (typeof fetch !== 'function') throw new Error('createCirclePodSharing: fetch (authenticated) required');
  if (!ownerWebId) throw new Error('createCirclePodSharing: ownerWebId required');
  // Per-container member roster (agent webid → modes); each change rewrites the
  // whole .acr (ACP, like WAC, has no incremental "add one policy").
  const rosters = new Map();   // containerUri → Map(agentWebId → modes[])

  function buildAcr(roster) {
    const lines = [
      `@prefix acp: <${ACP}>.`,
      `@prefix acl: <${ACL}>.`,
      '',
      // owner — full control, applied to the container + everything in it.
      `<#ownerMatcher> a acp:Matcher; acp:agent <${ownerWebId}>.`,
      `<#ownerPolicy> a acp:Policy; acp:allow acl:Read, acl:Write, acl:Control; acp:anyOf <#ownerMatcher>.`,
    ];
    const policies = ['<#ownerPolicy>'];
    let i = 0;
    for (const [agent, modes] of roster) {
      lines.push(
        `<#mMatcher${i}> a acp:Matcher; acp:agent <${agent}>.`,
        `<#mPolicy${i}> a acp:Policy; acp:allow ${aclModes(modes)}; acp:anyOf <#mMatcher${i}>.`,
      );
      policies.push(`<#mPolicy${i}>`);
      i += 1;
    }
    const applied = policies.join(', ');
    lines.push(
      '',
      `<#ac> a acp:AccessControl; acp:apply ${applied}.`,
      // accessControl → the container itself; memberAccessControl → contained resources.
      `<#acr> a acp:AccessControlResource; acp:resource <./>;`,
      `  acp:accessControl <#ac>; acp:memberAccessControl <#ac>.`,
    );
    return `${lines.join('\n')}\n`;
  }

  async function writeAcr(containerUri) {
    const roster = rosters.get(containerUri) ?? new Map();
    const res = await fetch(acrUriFor(containerUri), {
      method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: buildAcr(roster),
    });
    if (!res.ok) {
      throw new Error(`createCirclePodSharing: writing .acr for "${containerUri}" failed [${res.status}]`);
    }
  }

  return {
    async grant({ containerUri, agent, modes = ['read'] }) {
      if (!containerUri || !agent) return;
      const roster = rosters.get(containerUri) ?? new Map();
      roster.set(String(agent), modes);
      rosters.set(containerUri, roster);
      await writeAcr(containerUri);
    },
    async revoke({ containerUri, agent }) {
      if (!containerUri || !agent) return;
      const roster = rosters.get(containerUri);
      if (!roster || !roster.has(String(agent))) return;
      roster.delete(String(agent));
      try { await writeAcr(containerUri); }
      catch (err) { logger.warn?.('[circle-pod-sharing] revoke rewrite failed', err?.message ?? err); }
    },
  };
}
