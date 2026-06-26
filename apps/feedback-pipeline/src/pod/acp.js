// ACP (Access Control Policy) for the per-participant container (architecture §1.4) —
// the ACL that makes "consent = the write action" ENFORCED, not promised: only the
// participant may write/delete in their container; the owner (curation) keeps control +
// read; the aggregation service gets read. Proven against a live Community Solid Server.
//
// The activation service calls `provisionParticipantContainer` when setting a participant
// up (it has the project-pod owner's authenticated fetch).

const ACP_NS = 'http://www.w3.org/ns/solid/acp#';

/**
 * Turtle for a container's ACR: participant → read/write/append on the container AND its
 * members; owner → read/control; each reader → read. (`acp:memberAccessControl` applies
 * the same control to contained resources, so a participant's contributions inherit it.)
 */
export function containerAcp(containerUri, { participantWebId, ownerWebId, readers = [], writers = [] } = {}) {
  if (!participantWebId) throw new Error('containerAcp: participantWebId required');
  const policies = [`<#pPart> a acp:Policy; acp:allow acl:Read, acl:Write, acl:Append; acp:anyOf <#mPart>.`];
  const matchers = [`<#mPart> a acp:Matcher; acp:agent <${participantWebId}>.`];
  const applies = ['<#pPart>'];
  if (ownerWebId) {
    policies.push(`<#pOwner> a acp:Policy; acp:allow acl:Read, acl:Control; acp:anyOf <#mOwner>.`);
    matchers.push(`<#mOwner> a acp:Matcher; acp:agent <${ownerWebId}>.`);
    applies.push('<#pOwner>');
  }
  // writers — e.g. a Telegram bot SERVICE that writes consented contributions on behalf of
  // a participant (the post-receipt channel; canopy-chat participants write themselves).
  writers.forEach((w, i) => {
    policies.push(`<#pW${i}> a acp:Policy; acp:allow acl:Read, acl:Write, acl:Append; acp:anyOf <#mW${i}>.`);
    matchers.push(`<#mW${i}> a acp:Matcher; acp:agent <${w}>.`);
    applies.push(`<#pW${i}>`);
  });
  readers.forEach((w, i) => {
    policies.push(`<#pR${i}> a acp:Policy; acp:allow acl:Read; acp:anyOf <#mR${i}>.`);
    matchers.push(`<#mR${i}> a acp:Matcher; acp:agent <${w}>.`);
    applies.push(`<#pR${i}>`);
  });
  return `@prefix acp: <${ACP_NS}>.
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#ac> a acp:AccessControlResource; acp:resource <${containerUri}>;
  acp:accessControl <#c>; acp:memberAccessControl <#c>.
<#c> a acp:AccessControl; ${applies.map((p) => `acp:apply ${p}`).join('; ')}.
${policies.join('\n')}
${matchers.join('\n')}`;
}

/** Discover a resource's Access Control Resource URI via its Link header (rel="acl"). */
export async function acrUriOf(authedFetch, resourceUri) {
  const r = await authedFetch(resourceUri, { method: 'HEAD' });
  const m = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="acl"/);
  return m ? new URL(m[1], resourceUri).href : `${resourceUri}.acr`;
}

/** Create the participant's container and enforce its policy (called at activation, with
 *  the project-pod owner's authenticated fetch). */
export async function provisionParticipantContainer(ownerFetch, containerUri, opts) {
  const c = await ownerFetch(containerUri, {
    method: 'PUT',
    headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#Container>; rel="type"' },
  });
  if (!c.ok && c.status !== 205 && c.status !== 409) throw new Error(`create container failed: HTTP ${c.status}`);  // 409 = already exists → idempotent re-activation
  const acr = await acrUriOf(ownerFetch, containerUri);
  const a = await ownerFetch(acr, { method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: containerAcp(containerUri, opts) });
  if (!a.ok) throw new Error(`set ACP failed: HTTP ${a.status}`);
  return { container: containerUri, acr };
}
