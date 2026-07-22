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

import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
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

  return { agent, pubKey, received, sendPeerRedeem, pendingMap, label };
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
  const bus = new InternalBus();
  await a.agent.sa.addSecureTransport(transportName, new InternalTransport(bus, a.pubKey));
  await b.agent.sa.addSecureTransport(transportName, new InternalTransport(bus, b.pubKey));
  return bus;
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
  const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const joinerCallSkill = (app, op, args) => joiner.agent.callSkill(app, op, args);

  // 1. Create — the create wizard's real op path (createGroupState.finalSubmit →
  //    stoop.createGroupV2). buildRulesObjectFromState builds the rules blob.
  const state = createGroupInitialState();
  state.groupId = groupId;
  state.name = name;
  state.purpose = purpose;
  const { result: created, state: outState } = await createGroupFinalSubmit({ state, callSkill: adminCallSkill });
  if (!created) throw new Error(`createGroupV2 failed: ${outState?.submitError ?? 'unknown'}`);

  // 2. Invite — the admin reads the circle's current code + stamps its peer
  //    address (its chat pubKey — the address our shared-bus transport routes to).
  const invite = await buildCircleInviteUri({
    callSkill: adminCallSkill,
    circleId: groupId,
    adminPeerAddr: admin.pubKey,
  });
  if (invite?.error) throw new Error(`buildCircleInviteUri failed: ${invite.error}`);

  // 3. Redeem — the join wizard's real op path (joinGroupState.finalSubmit). The
  //    local redeemMembershipCode misses (joiner has no code item), so it falls
  //    back to sendPeerRedeem → group-redeem-request → admin verify → response →
  //    recordRemoteRedemption. THIS is the full app join the browser couldn't confirm.
  const joined = await joinCircleFromInvite({
    inviteUri: invite.uri,
    callSkill: joinerCallSkill,
    sendPeerRedeem: joiner.sendPeerRedeem,
    handle,
  });

  return { created, invite, joined, groupId };
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
