// The real `provisionPod` for the activation service against CSS (Tier 1): create the
// participant's ACP-locked container inside the project pod and return its URI. This is
// what plugs into activate.js's injected `provisionPod` seam. It takes the project-pod
// OWNER's authenticated fetch (no auth dependency here).

import { provisionParticipantContainer } from '../pod/acp.js';

/**
 * @param {object} a
 * @param {(url:string, init?:object)=>Promise<Response>} a.ownerFetch  project-pod owner's authed fetch
 * @param {string} a.projectPodBase    e.g. http://host/project/
 * @param {string} a.participant        pseudonym (the container name)
 * @param {string} a.participantWebId   the participant's webId (gets write/delete)
 * @param {string} a.ownerWebId         the owner's webId (read/control)
 * @param {string[]} [a.readerWebIds]   e.g. the aggregation service (read-only)
 * @param {string[]} [a.writerWebIds]   e.g. a Telegram bot service (writes on behalf)
 * @returns {Promise<{ podRef: string }>}  podRef = the container URI
 */
export async function provisionCssPod({ ownerFetch, projectPodBase, participant, participantWebId, ownerWebId, readerWebIds = [], writerWebIds = [] }) {
  const base = projectPodBase.endsWith('/') ? projectPodBase : `${projectPodBase}/`;
  const central = `${base}central/`;
  // ensure the owner-controlled central root exists (idempotent)
  await ownerFetch(central, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#Container>; rel="type"' } });
  const container = `${central}${encodeURIComponent(participant)}/`;
  await provisionParticipantContainer(ownerFetch, container, { participantWebId, ownerWebId, readers: readerWebIds, writers: writerWebIds });
  return { podRef: container };
}
