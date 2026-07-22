/**
 * pairRealAgents — wire two REAL basis app agents together in-process over a
 * shared InternalBus and drive the full application-level circle join between
 * them, deterministically, in node.
 *
 * This is the node-level analogue of the browser pairing journey
 * (`test-browser/journeys.spec.js` + `peerHarness.js`): instead of two isolated
 * browser contexts talking over NKN, it boots two `createRealHouseholdAgent()`
 * instances and connects their chat secure-mesh agents with a genuine
 * `InternalTransport` on ONE shared `InternalBus` — the exact wiring pattern
 * `packages/secure-agent/test/sendRouteResolution.test.js` uses. Delivery is
 * in-process microtask-async (no sockets / relay / network), so the full app
 * join runs in seconds and never flakes.
 *
 * It reuses the SAME production op/handler modules the web + mobile shells use —
 * no bespoke re-implementation of the join protocol:
 *   - create + invite   : createGroupState.finalSubmit → stoop.createGroupV2,
 *                         then v2/circleInvite.buildCircleInviteUri.
 *   - join / redeem      : v2/circleInvite.joinCircleFromInvite →
 *                         joinGroupState.finalSubmit (setMyHandle →
 *                         redeemMembershipCode → sendPeerRedeem fallback →
 *                         recordRemoteRedemption mirror).
 *   - peer bridge        : the real inbound router (handlers/peerRouter) + the
 *                         real group-redeem request/response handlers
 *                         (handlers/groupRedeem) + mesh intros (handlers/meshIntros).
 *
 * The ONE test-only seam: the browser shell wires the inbound peer router inside
 * `realAgent.connectPeerTransport({ nknLib, onPeerMessage })`. We don't call that
 * (there is no nknLib in node), so we hand `onPeerMessage` to the factory via its
 * existing `secureAgentOpts` pass-through (a late-binding ref, so the router — which
 * needs the booted agent's callSkill/sendPeerMessage — is attached after boot). No
 * production code changed; this uses only already-exported seams.
 */

import { InternalBus, InternalTransport } from '@onderling/core';
import {
  sealingPublicKeyFromNetworkKey,
  establishKeyEvent, rotateKeyEvent, readKeyChain, currentGroupKey, openAcrossKeyChain,
  sealForAudience,
} from '@onderling/pod-client';

import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { openerForIdentity } from '../../src/v2/sharedCopyOpener.js';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';
import {
  makeHandleGroupRedeemRequest,
  makeSendGroupRedeemRequest,
  makeHandleGroupRedeemResponse,
} from '../../src/core/handlers/groupRedeem.js';
import { makePropagateMeshIntros, makeHandleBuurtPeerIntro } from '../../src/core/handlers/meshIntros.js';

import {
  initialState as createGroupInitialState,
  finalSubmit as createGroupFinalSubmit,
} from '../../src/core/wizards/createGroupState.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';

/** Quiet logger so the handler modules don't spam the test output. */
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Resolve once `pred()` is truthy, polling briefly. Keeps the in-process async
 * (HI handshake + peer-bridge round-trip) deterministic without a fixed sleep.
 * Mirrors the helper in sendRouteResolution.test.js.
 */
export async function until(pred, { timeout = 4000, step = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - start >= timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

/**
 * Boot ONE real app agent with a late-bound inbound peer router. The router is
 * attached AFTER boot (it closes over the agent's callSkill/sendPeerMessage), so
 * the factory receives a ref-indirecting `onPeerMessage` at construction.
 *
 * @returns {Promise<{
 *   agent: object,
 *   pubKey: string,
 *   received: Array<{from: string, payload: object}>,
 *   sendPeerRedeem: Function,
 *   pendingMap: Map<string, object>,
 * }>}
 */
export async function bootRealAgentNode(label = 'agent') {
  const routerRef = { fn: null };
  const received = [];
  // A sealed circle's log carries key-events + sealed content over the real transport; a node records what
  // it receives here (inert for the unsealed default harness — these stay empty unless a sealed circle boots).
  const keyEvents = [];
  const sealedContent = [];

  const agent = await createRealHouseholdAgent({
    // Test-only seam: the browser wires this inside connectPeerTransport; in node
    // we hand it in via the existing secureAgentOpts pass-through. Ref-indirected
    // so the router can be built after boot with the live callSkill/sendPeerMessage.
    secureAgentOpts: { onPeerMessage: (env) => routerRef.fn?.(env) },
    // A fresh, code-minting REAL circle must show only real members — keep demo
    // scaffolding off so rosters carry exactly the creator + real joiners.
    seedDemoData: false,
  });

  const pubKey = agent.identity.chat.pubKey;
  const callSkill = (app, op, args) => agent.callSkill(app, op, args);
  const sendPeer = (addr, payload) => agent.sendPeerMessage(addr, payload);

  const pendingMap = new Map();
  const propagateMeshIntros = makePropagateMeshIntros({ callSkill, sendPeer, logger: QUIET });
  const handlers = {
    // ADMIN side: verify the joiner's code + reply, then propagate mesh intros.
    'group-redeem-request': makeHandleGroupRedeemRequest({ callSkill, sendPeer, propagateMeshIntros, logger: QUIET }),
    // JOINER side: resolve the pending redeem promise.
    'group-redeem-response': makeHandleGroupRedeemResponse({ pendingMap, logger: QUIET }),
    // Both sides: record a mesh-introduced peer into the local roster.
    'buurt-peer-intro': makeHandleBuurtPeerIntro({ callSkill, logger: QUIET }),
    // Sealed circle: a fanned key-event lands in this node's key-event log (the no-pod key-chain carrier);
    // sealed content lands in its content log. Recording is all a member does — folding happens on read.
    'group-key-event': (_from, payload) => { if (payload?.event) keyEvents.push(payload.event); },
    'sealed-content':  (_from, payload) => { if (payload?.env) sealedContent.push(payload); },
  };
  const sendPeerRedeem = makeSendGroupRedeemRequest({
    sendPeer,
    pendingMap,
    circleAddressFor: agent.circleAddressFor,
    timeoutMs: 8000,
    logger: QUIET,
  });

  routerRef.fn = makePeerRouter({
    handlers,
    // Everything else (plain chat-message bubbles, etc.) lands here for assertions.
    defaultHandler: (from, payload) => { received.push({ from, payload }); },
    logger: QUIET,
  });

  return { agent, pubKey, received, sendPeerRedeem, pendingMap, label, keyEvents, sealedContent };
}

/**
 * Connect two booted node agents so their chat secure-mesh agents can reach each
 * other in-process. Registers a genuine `InternalTransport(bus, <chatPubKey>)`
 * into EACH agent's unified router via `sa.addSecureTransport` — the wire address
 * IS the chat pubKey, so `sa.peer.sendTo(peerPubKey, …)` routes over the shared
 * bus with no PeerGraph needed (the peer's transport is registered under that
 * exact address). Mirrors sendRouteResolution.test.js.
 */
export async function connectAgentsOverBus(a, b, { transportName = 'relay' } = {}) {
  // A presence-aware bus so a `disconnect()` is a real "unreachable" signal
  // (membership-based `canReach`) — the offline/reconnect helpers rely on it.
  const bus = new InternalBus({ presenceAware: true });
  const txA = new InternalTransport(bus, a.pubKey);
  const txB = new InternalTransport(bus, b.pubKey);
  await a.agent.sa.addSecureTransport(transportName, txA);
  await b.agent.sa.addSecureTransport(transportName, txB);
  // Stash each node's bus transport so the offline/reconnect helpers can toggle
  // it (a disconnect on the shared bus = that node goes offline).
  a._busTransport = txA;
  b._busTransport = txB;
  return bus;
}

/**
 * Connect N booted node agents onto ONE shared presence-aware bus (the three-agent generalisation of
 * `connectAgentsOverBus`). Each node's chat transport is registered under its chat pubKey, so any node can
 * `sendPeerMessage(peer.pubKey, …)` to any other; each node's `_busTransport` is stashed for goOffline/goOnline.
 */
export async function connectNodesOverBus(nodes, { transportName = 'relay' } = {}) {
  const bus = new InternalBus({ presenceAware: true });
  for (const n of nodes) {
    const tx = new InternalTransport(bus, n.pubKey);
    await n.agent.sa.addSecureTransport(transportName, tx);
    n._busTransport = tx;
  }
  return bus;
}

/**
 * Take a node OFFLINE by disconnecting its shared-bus transport. It removes the
 * node's `msg:<addr>` listener + its `__peers` entry, so a peer's `canReach`
 * toward it now reports false — the transport-neutral "unreachable" signal the
 * send path's hold-forward rung keys on. (An InternalBus disconnect stands in
 * for a device that drops off the mesh.)
 */
export async function goOffline(node) {
  if (node?._busTransport) await node._busTransport.disconnect();
}

/**
 * Bring a node back ONLINE and emit a PRESENCE signal to `announceTo`: it
 * reconnects the bus transport (re-registering it) and sends a HI to the peer,
 * standing in for an agent re-announcing itself to known peers on reconnect.
 * That inbound HI is the presence signal that flushes anything the peer held
 * for this node. Pass no `announceTo` to reconnect silently (e.g. to then drive
 * the explicit `presenceSignal(addr)` reachability hook instead).
 */
export async function goOnline(node, { announceTo = null } = {}) {
  if (node?._busTransport) await node._busTransport.connect();
  if (announceTo && node?._busTransport) {
    try { await node._busTransport.sendHello(announceTo.pubKey, { pubKey: node.pubKey }); }
    catch { /* presence is best-effort; the explicit presenceSignal() hook is the fallback */ }
  }
}

/**
 * Drive the REAL app-level pairing: `admin` creates a circle + produces an invite;
 * `joiner` redeems it over the in-process transport. Returns everything the test
 * needs to assert (the invite URI, the join result, the resolved groupId).
 */
export async function pairCircle(admin, joiner, {
  groupId = 'peer-circle',
  name = 'Peer Circle',
  handle = 'peerbee',
  purpose = 'node pairing test',
} = {}) {
  const { created } = await createCircle(admin, { groupId, name, purpose });
  const { invite, joined } = await joinExistingCircle(admin, joiner, { groupId, handle });
  return { created, invite, joined, groupId };
}

/**
 * Create a circle via the real create-wizard op path (createGroupState.finalSubmit → stoop.createGroupV2).
 * The single-admin creator step, split out so ONE circle can then take MULTIPLE joiners (the sealed-circle
 * three-member case) instead of `pairCircle` minting a fresh circle per pair.
 */
export async function createCircle(admin, { groupId = 'peer-circle', name = 'Peer Circle', purpose = 'node pairing test' } = {}) {
  const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const state = createGroupInitialState();
  state.groupId = groupId;
  state.name = name;
  state.purpose = purpose;
  const { result: created, state: outState } = await createGroupFinalSubmit({ state, callSkill: adminCallSkill });
  if (!created) throw new Error(`createGroupV2 failed: ${outState?.submitError ?? 'unknown'}`);
  return { created, groupId };
}

/**
 * Join an EXISTING circle: the admin mints a fresh invite for the current code, the joiner redeems it over the
 * in-process transport (the real join wizard op path → group-redeem peer bridge → membership trail). Callable
 * repeatedly against one circle to admit several members.
 */
export async function joinExistingCircle(admin, joiner, { groupId = 'peer-circle', handle = 'peerbee' } = {}) {
  const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const joinerCallSkill = (app, op, args) => joiner.agent.callSkill(app, op, args);

  const invite = await buildCircleInviteUri({ callSkill: adminCallSkill, circleId: groupId, adminPeerAddr: admin.pubKey });
  if (invite?.error) throw new Error(`buildCircleInviteUri failed: ${invite.error}`);

  const joined = await joinCircleFromInvite({
    inviteUri: invite.uri,
    callSkill: joinerCallSkill,
    sendPeerRedeem: joiner.sendPeerRedeem,
    handle,
  });
  return { invite, joined, groupId };
}

// ── Sealed circle (posture p2) — a group key + rotations carried in the log, no pod ─────────────────────────
//
// The default harness circle is UNSEALED (no group key). These helpers boot a SEALED circle over the SAME real
// agents + transport: a member's stable sealing PUBLIC key is derived from its published network key
// (`sealingPublicKeyFromNetworkKey`), and its sealing PRIVATE key stays encapsulated behind an opener closure
// (`openerForIdentity` → AgentIdentity.sharedCopyOpener) — the exact app seam, no secret ever surfaced. Key
// establishment/rotation ride the log as key-events fanned over `sendPeerMessage` (real hold-forward when a peer
// is offline); content is sealed by the seal resolver under the current version and fanned the same way. This is
// the no-pod key-rotation mechanism end-to-end, with the harness standing in only for the stoop skill that would
// emit/record the events (as it already stands in for the browser's connectPeerTransport wiring).

/** A member's stable sealing PUBLIC key — derived from its published network key (deterministic, no trail dependency). */
export function memberSealingPubKey(node) {
  return sealingPublicKeyFromNetworkKey(node.pubKey);
}

/** A member's sealing OPENER: `(sealedText) => plaintext` bound to its sealing PRIVATE key, which never escapes
 *  the closure (the encapsulated `AgentIdentity.sharedCopyOpener` path the app uses for shared copies). */
export function memberOpener(node) {
  return openerForIdentity(node.agent.sa.agent.identity);
}

// Hold-forward on: a key-event/content send to an offline member is HELD (not lost), then flushed on reconnect.
const SEALED_SEND = { hold: true, firstSendTimeoutMs: 0, retryDelays: [] };

/** Fan a key-event to each recipient node over the real transport (offline recipients are held). */
async function fanKeyEvent(from, toNodes, groupId, event) {
  await Promise.all(toNodes.map((n) =>
    from.agent.sendPeerMessage(n.pubKey, { type: 'group-key-event', subtype: 'group-key-event', groupId, event }, SEALED_SEND)));
}

/**
 * Boot a sealed circle: the admin ESTABLISHES version-1 group key sealed to every member's sealing key and fans
 * that key-event to the members over the log/transport. The admin keeps its own copy in its key-event log.
 */
export async function bootSealedCircle({ admin, members = [], groupId }) {
  const recipients = [memberSealingPubKey(admin), ...members.map(memberSealingPubKey)];
  const { event } = establishKeyEvent({ groupId, recipients });
  admin.keyEvents.push(event);
  await fanKeyEvent(admin, members, groupId, event);
  return { groupId, recipients };
}

/**
 * The admin seals `text` under the CURRENT group-key version (folded from its own key-event log) via the seal
 * resolver, then fans the sealed envelope to `members`. Returns the tagged envelope (also recorded on receipt).
 */
export async function postSealed({ admin, members = [], groupId, text }) {
  const chain = readKeyChain(admin.keyEvents, { groupId, opener: memberOpener(admin) });
  const groupKey = currentGroupKey(chain);
  if (!groupKey) throw new Error('postSealed: the admin holds no current group key to seal with');
  const env = sealForAudience(text, { groupKey }, { audience: 'circle' });
  await Promise.all(members.map((n) =>
    admin.agent.sendPeerMessage(n.pubKey, { type: 'sealed-content', subtype: 'sealed-content', groupId, env }, SEALED_SEND)));
  return env;
}

/**
 * Remove a member + rotate: the admin mints the NEXT-version key sealed to the REMAINING recipients only (the
 * departed omitted → backward secrecy) and fans that rotation key-event to `keep` alone. Returns the new event.
 */
export async function removeAndRotate({ admin, keep = [], groupId }) {
  const recipients = [memberSealingPubKey(admin), ...keep.map(memberSealingPubKey)];
  const { event } = rotateKeyEvent({ groupId, priorEvents: admin.keyEvents, recipients });
  admin.keyEvents.push(event);
  await fanKeyEvent(admin, keep, groupId, event);   // the removed member is NOT among the recipients of this fan
  return { event };
}

/** A member reads a sealed envelope across the versions it holds (folds its key-event log, opens by trial). */
export function readSealed(node, env, groupId) {
  const chain = readKeyChain(node.keyEvents, { groupId, opener: memberOpener(node) });
  return openAcrossKeyChain(env, chain);
}

/** Read a circle roster via the real listGroupMembers op. */
export async function readRoster(node, groupId) {
  const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId });
  return Array.isArray(res?.members) ? res.members : [];
}

/** Best-effort shutdown of the underlying secure-mesh agents. */
export async function teardown(...nodes) {
  for (const n of nodes) {
    try { await n?.agent?.sa?.shutdown?.(); } catch { /* defensive */ }
  }
}
