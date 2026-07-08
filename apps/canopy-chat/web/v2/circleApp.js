/**
 * canopy-chat v2 — circle app boot (DEFAULT web entry, `index.html`).
 *
 * The v2 circle app is the landing page.  Per v2 §1 + §4 (and the
 * v2-design-is-canon decision), chat IS the kring view.  The classic
 * chat shell (web/main.js + classic.html) was removed 2026-06-29 once
 * the browser suite migrated to v2 and its flows had v2 equivalents.
 * Reuses the same bundled agent factory + shared circle
 * model. Opening a circle sets the active circle (F1) and shows the
 * kring view; the admin's `policy.view` axis chooses whether that lands
 * on GESPREK (chat) or the recipe'd Scherm (§4).  "+ new circle" creates
 * one via the existing createGroupV2 path and refreshes.
 *
 * ⚠ Needs a browser check: agent boot, live circle data, and create are
 * not unit-verifiable here (renderer/model/scope/content/create logic
 * are covered by tests).
 */

import { initLocalisation, t, setLang, detectDeviceLang, currentLang,
  parseInput, mergeManifests, resolveDispatch, runDispatch, scopeReadyDispatch,
  scopeStoopCallSkill, createCirclePodProducer, createCircleControlAgentRouter, realPodRouting, seedCircleRoster,
  isNoticeboardPost,
  canopyChatManifest, AppRegistry, filterCatalog } from '../../src/index.js';
// S4 pod foundation — per-circle sealed storage producer. The pod-client + in-memory
// pseudo-pod machinery is web-layer (kept out of the shared src so it stays portable);
// the producer just consumes the injected makePodClient/generateKeypair.
import { PodClient, generateKeypair as podGenerateKeypair, createSealedPodClient, SolidOidcAuth,
  createSealedPodDataSource, podGroupPrefix,
  recipientStrategy as podRecipientStrategy,
  sealingPublicKeyFromNetworkKey as podSealingPublicKeyFromNetworkKey } from '@canopy/pod-client';
import { createPseudoPod } from '@canopy/pseudo-pod';
import { pickWebBackend } from '../../src/web/persistentBackend.js';
import { VaultIndexedDB, VaultMemory, VaultLocalStorage } from '@canopy/vault';
// S4 circle OIDC — reuse the existing browser Solid-OIDC wrapper (no rebuild). A signed-in
// session routes a sealed circle to the user's REAL pod; otherwise the in-memory pseudo-pod.
import * as podAuth from '../../src/web/podAuth.js';
import { discoverPodRoot, createPodWriter } from '../../src/web/podStorage.js';
// Phase 5 — bot + feedback in the kring composer (mirrors mobile CircleLauncherScreen, on the shared
// engine). The circle bot stack:
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../../src/core/manifests/mockManifests.js';
import { calendarManifest } from '@canopy-app/calendar/manifest';
import { buildCircleLlmProviders } from '../../src/v2/circleLlmProviders.js';
import { createTokenGate } from '../../src/v2/tokenGate.js';
import { circleGateRules } from '../../src/v2/circleGate.js';
import { interpretToCommand } from '../../src/v2/interpretCommand.js';
import { createRelayPrefStore, localStorageRelayIo, resolveRelayUrl } from '../../src/v2/relayPref.js';
import { createCircleDispatch, addressesBot } from '../../src/v2/circleDispatch.js';
// Conversation memory — recent kring turns woven into the bot's interpret context.
import { recentKringTurns } from '../../src/v2/kringMemory.js';
import { createClarifyingDispatch } from '../../src/v2/clarifyingDispatch.js';
import { makeCircleLookup } from '../../src/v2/circleLookup.js';
import { sectionForScreen } from '../../src/v2/pageProjection.js';
import { createInputHistory } from '../../src/v2/commandSuggest.js';
import { beginFollowUp, completeFollowUp, beginFormFollowUp, completeMultiFieldFollowUp } from '@canopy/kring-host/followUp';
import { kringReplyText } from '../../src/v2/kringReply.js';
import { scopeCatalogToApps } from '../../src/v2/circleCatalogScope.js';
// B · Slice 1 — the default-deny capability gate applied at the user-dispatch waist (dispatchReady).
import { effectiveCapabilities, checkCapability } from '../../src/v2/capabilityGate.js';
// B · Slice 4 (4c) — the member's capability matrix drives affordance greying/hiding on reply buttons.
import { buildCapabilityMatrix } from '@canopy/app-manifest';
// D / SP-3b consumer-switch — select the projected PAGE surface (renderWeb) for
// the settings op so the live settings header is manifest-driven (invariant #4).
import { pageForOp } from '../../src/v2/pageProjection.js';
// B · Slice 3 — the interactive list-screen surface (search + category checkboxes + capability-gated rows).
import { renderListBlock } from './listScreen.js';
// feedback-extension P2c — load downloadable extension mappings + the load-time sandbox gate.
import { loadMappings } from '@canopy/pod-routing/mappings';
import { localStorageMappingsStore, WEB_MAPPINGS_DEVICE } from '@canopy/kring-host/mappingsStore';
import { verifyMappings, mappingsToSources } from '../../src/mappings.js';
import { DEFAULT_CIRCLE_ORIGINS } from '../../src/v2/circleSources.js';
import { buildConsentModel, installMapping } from '../../src/v2/extensionInstall.js';
import { createContactSkillRegistry } from '../../src/v2/contactSkillsLive.js';
import { createContactThreadChannel } from '../../src/v2/contactThreadChannel.js';
import { listContacts, mergeContacts, stoopContactToRow } from '../../src/v2/contactsSource.js';
import { addBotToGraph } from '../../src/v2/addBot.js';
import { createLocalStoragePeerBackend } from '../../src/web/localStoragePeerBackend.js';
import { renderContactsRoster } from './contactsRoster.js';
import { renderCircleProfile } from './circleProfile.js';
import { renderCircleAdminPanel } from './circleAdminPanel.js';
import { renderCircleMyData } from './circleMyData.js';
// S5 — key management: reuse the existing encrypted-backup + restore wizards
// (the slash/page renderers) inside My-data, mounted in a lightweight overlay.
import { renderEncryptedBackupWizard } from '../../src/web/wizards/encryptedBackupWizard.js';
import { renderRestoreFromMnemonicWizard } from '../../src/web/wizards/restoreFromMnemonicWizard.js';
// OBJ-2 membership — reuse the classic join wizard renderer in v2 via the same overlay adapter.
import { renderJoinGroupWizard } from '../../src/web/wizards/joinGroupWizard.js';
// S5 — web-push subscription orchestration (client half; server delivery is a
// Node-hosted stoop with VAPID keys). The SW receiver lives at web/sw.js.
import { enableWebPush, disableWebPush, getWebPushState } from '../../src/web/webPushClient.js';
// Objective D / Surface 4 (#180) — generic docked side-panel renderer for manifest ops
// that declare `surfaces.page` (first LIVE consumer: the my-data relay-URL editor).
import { openPagePanel } from '../../src/web/pagePanel.js';
// S5 — client-side image-attachment encoder (Canvas resize + thumbnail → the
// inbound shape stoop.postRequest expects).
import { encodeImageFile } from '../../src/v2/attachmentEncoder.js';
// S6.A — manifest-driven inline buttons on bot replies (the resurrected "inline menu").
import { embedButtonsForReply, embedsFromReply } from '../../src/v2/replyEmbeds.js';
// S6.C — per-user preference selecting which projection (inline / screen / minimal) renders.
import { selectSurfaceButtons, createSurfacePrefStore, localStorageSurfacePrefIo, SURFACE_PREFS } from '../../src/v2/surfacePref.js';
// S6.D — is the conversational "chat" projection enriched by an LLM here? (user-loaded LLM + circle permits)
import { resolveChatAi } from '../../src/v2/chatAi.js';
// §4 storage-policy bridge — the circle `pod` axis drives stoop's authoritative
// four-tier circle storage policy (admin-gated, one-way) instead of going nowhere.
import { pushCircleStoragePolicy } from '../../src/v2/circleStoragePolicy.js';
// Real ACP `sharing` for sealed circles on a real pod — a member redeem grants pod
// read of the circle container (true multi-device). Verified in circlePod2Pod.css.test.js.
import { createCirclePodSharing } from '../../src/v2/circlePodSharing.js';
// Calendar cross-peer fan-out — wrap the dispatch callSkill so a successful
// calendar op fans its invite/RSVP envelopes out over the peer transport.
import { withCalendarOutbound } from '../../src/core/handlers/calendarOutbound.js';
// embeds[] — resolve a cross-object ref to a live title for the "See also" chips.
import { enrichEmbedsWithTitles } from '../../src/v2/embedResolve.js';
// Calendar INBOUND ingest — receive invite/RSVP/cancel envelopes from peers.
import { makeHandleCalendarInvite } from '../../src/core/handlers/calendarInvite.js';
import { makeHandleFileShare }      from '../../src/core/handlers/fileShare.js';
import { makeHandleCalendarRsvp }   from '../../src/core/handlers/calendarRsvp.js';
import { makeHandleCalendarCancel } from '../../src/core/handlers/calendarCancel.js';
// Theme B — the settings chatbot: template-driven guided setup (remote-loadable, bundled fallback).
import { renderGuidedSetup } from './guidedSetupPanel.js';
import { startGuidedSetup, submitGuidedStep, guidedPolicyPatch, loadSettingsTemplate, DEFAULT_SETTINGS_TEMPLATE } from '../../src/v2/guidedSetup.js';
// B #64 — apply an authored remote recipe (loaded+validated → active circle policy) via the shared apply-wiring.
import { loadAndApplyRecipe } from '../../src/v2/recipeApply.js';
// B · consent-card — REVIEWED recipe apply: load→review model, then apply-with-opt-outs through the SAME gate.
import { loadRecipeForReview, applyReviewedRecipe } from '../../src/v2/recipeConsent.js';
// S6.C (per-circle) — gate an app's surfaces by the circle's policy.features.
import { isAppSurfaceEnabled } from '../../src/v2/appFeature.js';
import { renderContactThread } from './contactThread.js';
import { sendA2ATask, PeerGraph, discoverA2A } from '@canopy/core';
import { showConsentCard } from '../../src/web/extensionConsentCard.js';
import { createFeedbackSurface, parseFeedbackInvite, feedbackContactItem } from '../../src/feedback/feedbackSurface.js';
import { createFeedbackMount } from '../../src/feedback/feedbackMount.js';
import { buildFeedbackVerifyPods, getOrCreateRecoveryHash } from '../../src/feedback/feedbackPod.js';
import { feedbackBotFromInput, createFeedbackBotStore } from '../../src/v2/feedbackBots.js';
// (localStoragePolicyIo is already imported below with createCirclePolicyStore)
import { createUserLlmDefaultStore, localStorageUserLlmIo } from '../../src/v2/userLlmDefault.js';
import { applyUserLlmRuntime, validateUserLlmConfig } from '../../src/v2/userLlmRuntime.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { EventLog } from '../../src/eventLog.js';
// δ.2 — per-message delivery state for optimistic kring chat sends.
// Sibling of the EventLog (which stays append-only); read at render
// time by circleKring to surface pending/failed icons.
import { createDeliveryStateMap } from '@canopy/kring-host/deliveryState';
// Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out), web + mobile.
import { kringChatMessageEvent, broadcastKringFanOut } from '@canopy/kring-host/kringBroadcast';
// "only you" vs "whole kring" — message scope (a data property; the badge renders it).
import { scopeForReply } from '../../src/v2/messageScope.js';
import {
  buildCircleStream, buildKringStream,
} from '../../src/v2/circleStream.js';
import { isFeatureEnabled, defaultViewModeFromPolicy } from '../../src/v2/circlePolicy.js';
import { buildKringTabs, DEFAULT_KRING_TAB, featureTabId, featureForTabId } from '../../src/v2/kringTabs.js';
// D1 (§5A) — per-circle action-frequency counter behind the quickActions block.
import { createActionFrequencyStore } from '../../src/v2/actionFrequency.js';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';
// OBJ-2 membership — the peer-redeem handshake (joiner ⇄ admin) is shared core; v2 just wires the
// same three factories the classic shells use (groupRedeem.js) into its peer router + join glue.
import { makeHandleGroupRedeemRequest, makeHandleGroupRedeemResponse, makeSendGroupRedeemRequest } from '../../src/core/handlers/groupRedeem.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';
import { feedHouseholdRoster } from '../../src/v2/householdRosterPairing.js';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';
import { rehydrateKringChatsFromStoop } from '../../src/v2/kringChatRehydrate.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
// ε.4 — negotiated catch-up protocol substrate.
import { makeCatchUpProviderHandler } from '../../src/v2/catchUpProvider.js';
import { makeCatchUpReceiver }        from '../../src/v2/catchUpReceiver.js';
import {
  makeRequestCatchUpFromKnownPeers, makeHandleCatchUpRequest,
} from '../../src/core/handlers/catchUp.js';
// γ-next.recipe — receiver + pending-cache substrate for the recipe broadcast.
import { makeKringRecipePeerHandler } from '../../src/v2/kringRecipeReceiver.js';
import { createKringRecipePendingStoreLocal } from '../../src/v2/kringRecipePendingStorage.js';
// γ-next.rules — receiver + pending-cache substrate for the rules broadcast.
import { makeKringRulesPeerHandler } from '../../src/v2/kringRulesReceiver.js';
import { createKringRulesPendingStoreLocal } from '../../src/v2/kringRulesPendingStorage.js';
// γ-next.policy — receiver + pending-cache substrate for the policy broadcast.
import { makeKringPolicyPeerHandler } from '../../src/v2/kringPolicyReceiver.js';
import { createKringPolicyPendingStoreLocal } from '../../src/v2/kringPolicyPendingStorage.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render + bg refresh).
import { createScreenBlocksCacheLocal } from '../../src/v2/screenBlocksCacheStorage.js';
import {
  createKringRecipeStore, localStorageRecipeIo, getActiveRecipe,
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
} from '../../src/v2/kringRecipe.js';
import { materializeRecipe, materializeBlock } from '../../src/v2/kringRecipeBlocks.js';
// α.2 — user-owned cross-kring screens (the Schermen tab) + α.3 picker.
import {
  createUserScreenStore, localStorageScreenIo,
  addScreen as addUserScreen, renameScreen as renameUserScreen,
  removeScreen as removeUserScreen, setActiveScreen, getActiveScreen, updateScreen,
} from '../../src/v2/userScreens.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { renderCircleKring } from './circleKring.js';
import { makeCircleLists } from '@canopy/kring-host/circleLists';  // cluster K · K2 — composable lists (shared web≡mobile)
// cluster K — the app-level cross-circle SHARE op. The {onShare, policy} binder + resource-URI resolver are
// pod-layer, composed at the pod site below; the op logic itself is shared (web≡mobile) in circleShare.js.
import { sealItem, isCanonicalPosture } from '@canopy/item-store';
import {
  shareItemAcrossCircles, shareItemToPublishedKey, listSharedResolved, revokeItemShare, listOutboundShares, revokeAllForMember,
} from '../../src/v2/circleShare.js';
// objective L · Phase 2 — the out-of-circle recipient picker (thin DOM over the SHARED `pickableRecipients`).
import { renderRecipientPicker } from './recipientPicker.js';
// The platform-neutral enforcement assembly (web≡mobile — mobile's circlePods.js calls the SAME builder).
import { buildCircleShareEnforcement } from '../../src/v2/circleShareEnforcement.js';
import { renderContainerCard } from './containerCard.js';      // cluster K · K2 — the nested container card (web DOM)
import { buildHouseholdDataSource } from '../../../household/src/storage/persist.js';  // portable persistent DataSource (IDB on web) — submodule import so canopy-chat's live path no longer loads the retired household skillRegistry/HouseholdAgent via index.js (L3)

// The app-wide DEFAULT lists service, PERSISTENT: an IndexedDB-backed DataSource (lists survive a reload).
// Lazy + memoised (the DataSource build is async); falls back to in-memory if IDB is unavailable (e.g. SSR/tests).
let _circleListsPromise = null;
function getDefaultCircleLists() {
  if (!_circleListsPromise) {
    _circleListsPromise = (async () => {
      let dataSource;
      try { dataSource = await buildHouseholdDataSource({ dbName: 'cc-circle-lists-state', storeName: 'items' }); }
      catch { dataSource = undefined; }   // no IDB → in-memory (makeCircleLists' default)
      return makeCircleLists({ dataSource });
    })();
  }
  return _circleListsPromise;
}

// L1b — a SEALED, POD-BACKED lists service per circle (opt-in). When a pod session is present AND the circle
// resolves a sealing strategy (a sealed p2/p3 posture with an available group key), the circle's lists persist
// to the user's REAL pod with content sealed at rest under the group key — the keys BE the canonical
// `resourceUriFor` pod URIs (rootPrefix = `<podRoot>/group/`). Absent a session/strategy this returns null and
// the caller keeps the IDB/memory default, so NOTHING breaks when no pod session is configured (additive).
const _podCircleListsByCircle = new Map();   // circleId → Promise<listsSvc | null>
async function getPodCircleLists(circleId, policy) {
  if (!circleId || !circleAuthedFetch || !circleRealPodRouting?.podRoot) return null;
  if (!_podCircleListsByCircle.has(circleId)) {
    _podCircleListsByCircle.set(circleId, (async () => {
      try {
        // The circle's CONTENT seal/open strategy (group-key custody via its control-agent). p0/p1 or a
        // not-yet-provisioned group key → null; we then decline the pod path rather than write plaintext.
        const strategy = await getCircleSealStrategy(circleId, policy);
        if (!strategy) return null;
        const dataSource = createSealedPodDataSource({
          fetch: circleAuthedFetch,
          podUrl: circleRealPodRouting.podRoot,
          strategy,
        });
        // K plug-in point — NOW WIRED (app-level share op). With this sealed DataSource live, cross-circle
        // sharing binds through `getCircleShareEnforcement(circleId, policy)` below, which builds
        //   makeCircleShareEnforcement({ sharing: prod.podClient.sharing,
        //     resourceUriFor: sharedRefResourceUri(makeResourceUriResolver({ podUri: podRoot })),
        //     open: strategy.open })
        // — all inputs (sharing via prod.podClient, the strategy, podRoot) are resolved here / in
        // ensureCirclePod. Deviation from the original note: `seal` is OMITTED — the live posture is the
        // group-key one (p2/p3 group-key provisioning), where the recipient already holds the key via the
        // roster, so the substrate's makeShareGrantHook explicitly skips re-seal (no source-item rewrite).
        return makeCircleLists({ dataSource, rootPrefix: podGroupPrefix(circleRealPodRouting.podRoot) });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circleApp] pod-backed lists unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _podCircleListsByCircle.get(circleId);
}

// Resolve the lists service for a circle: the sealed pod-backed one when available, else the app default.
async function getCircleLists(circleId, policy) {
  const pod = await getPodCircleLists(circleId, policy);
  return pod || getDefaultCircleLists();
}

// cluster K — the POD-TIER enforcement binder for a circle's cross-circle SHARE, built at the K plug-in
// point (the sealed-pod path above). Returns `{ onShare, policy }` (write-grant + read-gate over ONE
// `resourceUriFor` + mode) when the circle's pod path is ACTIVE — a signed-in real-pod routing, the
// pod-client's ACP `sharing` surface, AND a resolved sealing strategy. Absent any of those it returns
// null and the share op degrades to the in-memory `shared-ref` behaviour (no grant, no seal, no read
// gate) — the memory/IDB default is byte-unchanged.
const _shareEnforcementByCircle = new Map();   // circleId → Promise<{onShare,policy} | null>
async function getCircleShareEnforcement(circleId, policy) {
  if (!circleId) return null;
  const podRoot = circleRealPodRouting?.podRoot;
  if (!podRoot) return null;                                  // not signed in → memory path
  if (!_shareEnforcementByCircle.has(circleId)) {
    _shareEnforcementByCircle.set(circleId, (async () => {
      try {
        const prod     = await ensureCirclePod(circleId, policy);
        const strategy = await getCircleSealStrategy(circleId, policy);
        const sharing  = prod?.podClient?.sharing;             // client.sharing = { grant, list } (resourceUri shape)
        // This device's per-circle sealing identity (the canonical controller key — already a group-key
        // recipient). Best-effort; absent ⇒ the shared builder skips the canonical hooks.
        let idKey = null;
        try { idKey = prod?.sealingIdentity ? await prod.sealingIdentity.ensure() : null; } catch { idKey = null; }
        // The platform-neutral assembly lives ONCE in shared src (circleShareEnforcement.js) — web≡mobile call
        // the SAME builder. It requires a real ACP `sharing` (grant+list) AND a resolved seal strategy (p2/p3);
        // otherwise it returns null (decline the pod path — the memory/IDB default is byte-unchanged). It also
        // wires the CANONICAL controller (objective L) from the control agent's group-key resource + this
        // device's sealing identity, re-wrapping the group key to the live origin roster on every grant.
        return buildCircleShareEnforcement({
          sharing, strategy, podRoot,
          controlAgent: prod?.controlAgent,
          idKey,
        });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circleApp] share enforcement unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _shareEnforcementByCircle.get(circleId);
}

// Read a circle's policy (storagePosture etc.) best-effort — drives the sealed-pod path for that circle.
async function _circlePolicy(circleId) {
  try { return (await policyStore.get(circleId)) ?? {}; } catch { return {}; }
}
// Resolve a circle's lists service using its own policy (shared by the share write + read paths).
async function _circleServiceFor(circleId) {
  return getCircleLists(circleId, await _circlePolicy(circleId));
}

/**
 * cluster K — the app-level cross-circle SHARE write op. Shares ONE item from `fromCircleId` into
 * `toCircleId`'s audience: writes the `shared-ref` into the target AND (pod-active source) lands the ACP
 * read-grant (+ seal via the group key) so the target's members can actually resolve it. Recipients default
 * to the TARGET circle's member WebIDs (a circle share → its members); a pod share REFUSES with no recipient.
 */
async function shareItemIntoCircle({ itemId, fromCircleId, toCircleId, by, recipient, recipients } = {}) {
  let who = recipients;
  if ((!Array.isArray(who) || who.length === 0) && !recipient) {
    // Resolve the target circle's member WebIDs (reuses the existing stoop roster op).
    try {
      const members = normalizeCircleMembers(await resolveCallSkill('listGroupMembers', { groupId: toCircleId }));
      who = members.map((m) => m.webid ?? m.id).filter(Boolean);
    } catch { who = undefined; }
  }
  // slice 3a — resolve each recipient's SEALING PUBLIC KEY from the TARGET circle's roster, so a cross-circle
  // recipient (NOT in the source's group key) can decrypt the re-sealed content. A recipient missing from the
  // target roster resolves to no key ⇒ deny-by-default (dropped from the re-seal; the grant hook still refuses
  // a keyless recipient-seal). Best-effort: a plaintext/unprovisioned source just gets an empty key set.
  const whoList = Array.isArray(who) && who.length ? who : (recipient ? [recipient] : []);
  let recipientKeys = [];
  try {
    recipientKeys = (await Promise.all(whoList.map((w) => recipientSealKeyFor(toCircleId, w)))).filter(Boolean);
  } catch { recipientKeys = []; }
  return shareItemAcrossCircles({
    resolveService: _circleServiceFor,
    enforcementFor: _shareEnforcementFor,
    // slice 2 — the initiator gate reads the SOURCE circle's admin policy (sharePosture + admins).
    policyOf: _circlePolicy,
    // slice 3b — recipient re-seal: the resolved keys + the injected copy-mode re-sealer (pod-client crypto).
    recipientKeys, sealCopy: sealCopyToRecipients,
    itemId, fromCircleId, toCircleId, by: by ?? LOCAL_ACTOR,
    recipient, recipients: who,
  });
}

/**
 * objective L — UN-SHARE (revoke) a recipient's canonical access to an item. Only the `canonical` posture
 * has a revocable in-place grant to rotate; other postures return `not-canonical`. There is no dedicated UI
 * trigger for this yet (a "stop sharing" affordance on a shared item is a follow-up); this is the wired,
 * invocable callable path (used by the substrate test + any future member-removal / un-share event). Rotates
 * the item's group key to the remaining origin recipients + ACP-revokes the departing WebID(s).
 */
async function unshareItemFromCircle({ itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients } = {}) {
  return revokeItemShare({
    resolveService: _circleServiceFor,
    enforcementFor: _shareEnforcementFor,
    policyOf: _circlePolicy,
    itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients,
  });
}

/**
 * objective L · Phase 2 — SHARE one canonical item OUT to an OUT-OF-CIRCLE contact, identified by their
 * PUBLISHED network key (the `recipientNetworkKey` the recipient picker read straight off the contact row).
 * Thin pass-through to the SHARED `shareItemToPublishedKey` (no share/seal logic here); the composition root
 * supplies the same resolveService / enforcementFor / policyOf trio the circle-share path uses, PLUS the
 * injected copy-seal + network-key derivation the `silent` policy path needs. `toCircleId` is now OPTIONAL (a
 * pure person-share needs none); `includeHistory` (default off) opts the recipient into the pre-grant history.
 * The `shareOutOfCircle` policy axis decides prohibit / notify / silent.
 */
async function shareItemToContact({ itemId, fromCircleId, toCircleId, by, recipient, recipientNetworkKey, verify, includeHistory } = {}) {
  return shareItemToPublishedKey({
    resolveService: _circleServiceFor,
    enforcementFor: _shareEnforcementFor,
    policyOf: _circlePolicy,
    sealCopy: sealCopyToRecipients,
    sealingKeyFromNetworkKey: podSealingPublicKeyFromNetworkKey,
    // NOTICE emitters (routed by the circle's `notifyOutOfCircle` setting): `admins` pings the circle admins,
    // `post` lands a category-tagged noticeboard post. Both best-effort — a notice never fails the share.
    // `notify` (admins) → @canopy/notify-envelope wiring is a follow-up; today it records the event.
    notify: (payload) => { try { console.info?.('[share] out-of-circle', payload); } catch { /* noop */ } },
    // `post` → write the tagged post to the source circle's noticeboard item store (reuses the existing
    // `type:'post'` machinery). The `category:'permission-log'` tag lets a future logging section filter it out.
    post: async (taggedPost) => {
      try {
        const svc = await _circleServiceFor(taggedPost.fromCircleId);
        const store = svc?.stores?.getStore?.(taggedPost.fromCircleId);
        if (store && typeof store.put === 'function') await store.put(taggedPost, { by: taggedPost.by });
      } catch { /* best-effort */ }
    },
    // SILENT delivery (Frits' call) — push the sealed COPY over the relay directly to the recipient's peer.
    // The recipient's peer address IS their published network key (`recipientNetworkKey`); the peer transport
    // (agent.sendPeerMessage) is the SAME channel the no-pod sync + file-share fan-out ride. Best-effort inside
    // the shared op. Guarded so a boot with no live agent degrades to pointer-only (no throw).
    sendSharedCopy: (to, envelope) =>
      (typeof _peerAgent?.sendPeerMessage === 'function'
        ? _peerAgent.sendPeerMessage(to, envelope)
        : Promise.resolve()),
    itemId, fromCircleId, toCircleId, by: by ?? LOCAL_ACTOR,
    recipient, recipientNetworkKey, verify, includeHistory,
  });
}

// Resolve a circle's {onShare, policy} binder with that circle's own policy; null-safe for enforcementFor.
async function _shareEnforcementFor(circleId) {
  try { return await getCircleShareEnforcement(circleId, await _circlePolicy(circleId)); }
  catch { return null; }
}

/**
 * share-policy slice 3a — resolve a recipient's SEALING PUBLIC KEY from the TARGET circle's roster (the
 * redemption trail the control agent already holds). NO publish, NO WebID network resolution (per
 * ADVICE-cross-circle-sharing-key-model.md): the circle-scoped key is already local. Two roster sources,
 * both circle-scoped:
 *   1. the circle's control-agent roster (`ensureCirclePod → controlAgent.members()` → {webId, publicKey}) —
 *      the exact keys the circle wraps its group key to, and
 *   2. stoop `listGroupMembers` ({webid, sealingPublicKey}), the authoritative redemption roster.
 * Returns null when the recipient isn't in the target roster ⇒ deny-by-default: no re-seal, their share is
 * refused (consistent with the existing `share-grant-failed`).
 *
 * @param {string} circleId  the TARGET circle to share INTO
 * @param {string} webId     the recipient's WebID
 * @returns {Promise<string|null>}
 */
async function recipientSealKeyFor(circleId, webId) {
  if (!circleId || !webId) return null;
  // 1. Control-agent roster (in-app, circle-scoped) — the group-key recipient public keys.
  try {
    const prod = await ensureCirclePod(circleId, await _circlePolicy(circleId));
    const members = typeof prod?.controlAgent?.members === 'function' ? prod.controlAgent.members() : [];
    const k = recipientSealKeyFromMembers(members, webId);
    if (k) return k;
  } catch { /* fall through to the stoop roster */ }
  // 2. stoop listGroupMembers — the redemption roster carries each joiner's sealingPublicKey.
  try {
    const res = await resolveCallSkill('listGroupMembers', { groupId: circleId });
    return recipientSealKeyFromMembers(res, webId);
  } catch { return null; }
}

/**
 * slice 3b — an injected COPY re-sealer: `(item, keys) => item with its content fields sealed to `keys``
 * (recipientStrategy, host-blind: needs only public keys). item-store's `sealItem` walks the CONTENT fields
 * (structural keys stay plaintext), the pod-client `recipientStrategy` supplies the crypto — so circleShare
 * stays pod-client-free (the seal is injected from this pod layer).
 */
function sealCopyToRecipients(item, keys) {
  const strat = podRecipientStrategy({ recipients: keys });
  return sealItem(item, (text) => strat.seal(text));
}

/**
 * slice 3b — the READER's own per-text opener for a circle: `recipientStrategy({privateKey}).open` built from
 * this device's per-circle sealing identity. Opens content re-sealed to THIS reader's key (copy mode). Null
 * when no sealing identity is available (plaintext / not provisioned) → the read falls back to the source
 * enforcement's own `open`.
 *
 * @param {string} circleId  the circle the reader is reading shared items INTO (their own key context)
 * @returns {Promise<((text:string)=>string)|null>}
 */
async function circleReaderOpen(circleId) {
  try {
    const prod = await ensureCirclePod(circleId, await _circlePolicy(circleId));
    if (!prod?.sealingIdentity?.ensure) return null;
    const idKey = await prod.sealingIdentity.ensure();
    if (!idKey?.privateKey) return null;
    const strat = podRecipientStrategy({ privateKey: idKey.privateKey });
    return (text) => strat.open(text);
  } catch { return null; }
}

/**
 * cluster K — the READ path: everything shared INTO `circleId`, resolved deny-by-default. A ref this reader
 * isn't a recipient of resolves to null and is dropped (never surfaced) — no plaintext/ciphertext leak.
 * `recipient` is my WebID on a pod (the grant-check subject); memory path ignores it (no policy).
 */
async function listSharedItems(circleId, { recipient } = {}) {
  // slice 3b — the reader's OWN opener (their per-circle sealing key) so content re-sealed to them (copy mode)
  // decrypts; a non-recipient's opener throws ⇒ resolveSharedRef drops the ref (deny-by-default, no leak).
  const readerOpen = await circleReaderOpen(circleId);
  return listSharedResolved({
    resolveService: _circleServiceFor,
    enforcementFor: _shareEnforcementFor,
    circleId,
    recipient: recipient ?? circleOwnerWebId ?? undefined,
    readerOpen: readerOpen ?? undefined,
  });
}
import { renderCircleScreen } from './circleScreen.js';
import { renderRecipeEditor } from './circleRecipeEditor.js';
// ε.6 — multi-offer catch-up chooser modal (opt-in via
// policy.catchUpChooserMode === 'prompt').
import { renderCatchUpChooser } from './catchUpChooserModal.js';
import { renderScreensPicker } from './circleScreensPicker.js';
import { computeAdvice, makeTooBusyEvent } from '../../src/v2/circleAdvisor.js';
import { normalizeHopMode } from '@canopy/kring-host/circleHop';
import { mergeSkill, normalizeSkill } from '@canopy/kring-host/circleSkills';
import { buildCircleFiles, circleFilesFromListFiles } from '../../src/v2/circleFolio.js';
import { myThingsFromListFiles } from '../../src/v2/folioMyThings.js';
import {
  sharedFilesFromListFiles, FOLIO_SHARE_FILTERS,
} from '../../src/v2/folioSharedFilters.js';
import { buildNearbyModel } from '../../src/v2/circleNearby.js';
import { renderCircleStream } from './circleStream.js';
import { renderCircleNearby } from './circleNearby.js';
import { renderCircleMyThings } from './circleMyThings.js';
import { renderCircleAdvisor } from './circleAdvisor.js';
import { renderCircleHop } from './circleHop.js';
import { renderSkillEditor } from './circleSkillEditor.js';
import { renderCircleFolioBrowser } from './circleFolio.js';
import {
  normalizeRulesDoc,
  // γ.2 — per-circle rules store factory + localStorage io (was inline
  // localStorage in showRules()).  Routes saves through a single hook
  // point that snapshots into the versions adapter.
  createCircleRulesStore, localStorageRulesIo,
} from '../../src/v2/circleRules.js';
import { renderRulesEditor } from './circleRulesEditor.js';
// γ.2 — concrete versions adapter (localStorage-backed).  Wired ONCE
// per kring store at construction time; snapshots every save into
// `cc.versions.<storeName>.<circleId>`.  Invisible to the UI in γ.2;
// γ.3 will surface the history.
import { localStorageObjectVersions } from '@canopy/kring-host/objectVersionsStorage';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircleItems } from '../../src/v2/circleContent.js';
import { makeCircleRetriever, DEFAULT_CIRCLE_RAG_MIN_SCORE } from '../../src/v2/circleRetriever.js';
import { buildCircleEmbedProviders } from '../../src/v2/circleEmbedProviders.js';
import { resolveCircleEmbedder } from '../../src/v2/embedPicker.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { normalizeCircleMembers, recipientSealKeyFromMembers } from '@canopy/kring-host/circleMembers';
import { buildFindExtras } from '@canopy/kring-host/findExtras';
import { executeBulkDispatch } from '../../src/bulkOps.js';
import { mergeCirclePolicy, mergeMemberOverride, normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { makeProposal, pendingApprovers } from '../../src/v2/circleConsensus.js';
import { createProposalStore, localStorageProposalIo } from '../../src/v2/circleProposalStore.js';
// P6.10 #348 — agent-add admin approval store (board 4B).
import { createAgentRequestStore } from '../../src/v2/agentRequest.js';
import { buildTilePreviews, bumpSeenAt } from '../../src/v2/circleTilePreviews.js';
import { makeAfterClaimHook } from '../../src/v2/claimRouter.js';
import { mergeAvailability } from '../../src/v2/memberAvailability.js';
import { createAvailabilityStore, localStorageAvailabilityIo, podAvailabilityIo, tieredAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { renderCircleAvailability } from './circleAvailability.js';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
// β.5 — per-user "pin to top" store + adapter.
import { createCirclePinStore, localStoragePinIo } from '../../src/v2/circlePinStore.js';
// SILENT out-of-circle delivery — the per-user "shared with me" store + adapter, and the inbound handler that
// lands relayed sealed copies into it (peer router subtype `shared-copy`).
import { createSharedWithMeStore, localStorageSharedWithMeIo, podSharedWithMeIo, tieredSharedWithMeIo } from '../../src/v2/sharedWithMeStore.js';
import { makeHandleSharedCopy } from '../../src/core/handlers/sharedCopyReceive.js';
// SILENT out-of-circle delivery — the "shared with me" VIEW (web DOM projector) + the shared
// open selector. The nav entry lives on the Mij profile (personal, cross-circle inbox).
import { renderSharedWithMe } from './sharedWithMe.js';
import { buildSharedWithMe, openSharedCopy } from '../../src/v2/sharedWithMe.js';
// SILENT out-of-circle delivery — THIS device's network-derived sealing OPENER (shared web≡mobile). Injects the
// pod-client sealing adapter into the encapsulated identity secret; only the opener closure escapes.
import { openerForIdentity } from '../../src/v2/sharedCopyOpener.js';
import { renderCircleViewAs } from './circleViewAs.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleTabBar, hideCircleTabBar } from './circleTabBar.js';
import { renderCircleSettings } from './circleSettings.js';
import { renderCircleOverride } from './circleOverride.js';

// SP-13.2 — actor label stamped on local chat-message events.  Real WebID/
// peer-display wiring lands with peer broadcast (SP-13.2.1).
const LOCAL_ACTOR = 'me';

// SP-13.2.1 — best-effort peer bootstrap.  Transport-neutral / local-first: NKN is one transport,
// not a prerequisite. Bring up whichever is available — NKN (CDN) and/or the relay (VITE_CIRCLE_RELAY_URL).
// A configured relay alone is enough for the LAN no-pod two-device path; with NKN too the router picks
// the best route. Doesn't throw if neither is available — the kring view still works locally.
async function tryConnectPeerTransport(agent, peerMessageRouter) {
  const nknLib =
       (typeof window !== 'undefined' && window.nkn)
    ?? (typeof globalThis !== 'undefined' && globalThis.nkn)
    ?? null;
  if (!nknLib && !CIRCLE_RELAY_URL) {
    console.info('[circleApp] no nkn-sdk and no relay URL — kring chat is local-only this session');
    return;
  }
  if (typeof agent?.connectPeerTransport !== 'function') {
    console.info('[circleApp] agent has no connectPeerTransport — kring chat is local-only');
    return;
  }
  try {
    // T5.2d — rendezvous:true opts in to direct WebRTC upgrades (signalled over nkn/relay).
    // The browser provides globalThis.RTCPeerConnection, so no rtcLib is needed here; the
    // unified router then prefers the direct DataChannel over nkn/relay once it opens.
    await agent.connectPeerTransport({
      nknLib:        nknLib ?? undefined,   // relay-only when the CDN didn't load
      onPeerMessage: peerMessageRouter,
      relayUrl:      CIRCLE_RELAY_URL,
      rendezvous:    true,
    });
    const routes = [nknLib && 'nkn', CIRCLE_RELAY_URL && 'relay'].filter(Boolean).join(' + ');
    console.info(`[circleApp] peer transport connected (${routes}, routed) + rendezvous`);
  } catch (err) {
    console.warn('[circleApp] peer connect failed — kring chat is local-only:', err?.message ?? err);
  }
}

// In-app relay setting (Settings → Mij): persist the URL, update the resolved value, and RECONNECT the
// peer transport live so it takes effect without a page reload. Returns `{ ok, effective }` — the URL now
// in use (the setting, or the env fallback when cleared). web≡mobile (mobile mirrors this in hostOps).
async function applyRelayUrl(url) {
  const saved = await relayPrefStore.set(url);
  CIRCLE_RELAY_URL = resolveRelayUrl(saved, CIRCLE_RELAY_ENV);
  if (_peerAgent) {
    try { await tryConnectPeerTransport(_peerAgent, _peerRouter); }
    catch (err) { return { ok: false, error: err?.message ?? String(err), effective: CIRCLE_RELAY_URL }; }
  }
  return { ok: true, effective: CIRCLE_RELAY_URL };
}

// γ.2 — versions adapters per kring store.  Wired here at construction
// so capture happens ABOVE the (localStorage / pod) tier — γ.3 will
// read these slots for 3-way merge after a remote sync.  Each store
// keys into its own slot prefix to keep histories isolated.
const policyVersions = localStorageObjectVersions('policy');
const recipeVersions = localStorageObjectVersions('recipe');
const rulesVersions  = localStorageObjectVersions('rules');

const policyStore = createCirclePolicyStore({ ...localStoragePolicyIo(), versions: policyVersions });
// α.1c — per-kring recipe book store (multi-recipe per kring, one active).
// localStorage now; pod io can swap in later without touching callers.
const recipeStore = createKringRecipeStore({ io: localStorageRecipeIo(), versions: recipeVersions });
// D1 (§5A) — per-circle action-frequency counter (the quickActions row).
// Hydrated from localStorage at boot; persists its snapshot on every bump.
const ACTION_FREQ_KEY = 'cc.actionFrequency';
const actionFrequency = createActionFrequencyStore(readActionFreqSnapshot(), {
  onChange: (snap) => {
    try { window.localStorage.setItem(ACTION_FREQ_KEY, JSON.stringify(snap)); }
    catch { /* quota / disabled */ }
  },
});
function readActionFreqSnapshot() {
  try {
    const raw = window.localStorage.getItem(ACTION_FREQ_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
// D1 (§5A) — in-memory fallback recipe for a kring with no authored scherm:
// just the "Veel-gebruikt" row.  Never persisted.
const DEFAULT_SCHERM_RECIPE = Object.freeze({
  // #16 — the default scherm leads with quick-actions, then the noticeboard (the
  // buurt prikbord via stoop listOpen), so a scherm-landing circle still surfaces
  // the open posts even though the prikbord tab lives in the (hidden) chat view.
  id: '__default__', name: '', blocks: [
    { id: 'qa-default', type: 'quickActions', config: { limit: 4 } },
    { id: 'nb-default', type: 'noticeboard',  config: { limit: 8 } },
  ],
});
// γ.2 — per-circle rules store (replaces inline localStorage in showRules()).
const rulesStore  = createCircleRulesStore({ ...localStorageRulesIo(), versions: rulesVersions });
// γ-next.recipe — per-kring "incoming recipe" cache.  Receiver writes
// here on every valid kring-recipe-broadcast envelope; the recipe
// editor reads on mount + passes the cached recipe via γ.3's
// `incomingRecipe` opt.  localStorage now; pod-sync swap is the
// same shape as the other stores.
const kringRecipePendingStore = createKringRecipePendingStoreLocal();
// γ-next.rules — per-kring "incoming rules" cache.  Receiver writes
// here on every valid kring-rules-broadcast envelope; the rules
// editor reads on mount + passes the cached doc via γ.4's
// `incomingRules` opt.  Same shape as the recipe store.
const kringRulesPendingStore = createKringRulesPendingStoreLocal();
// γ-next.policy — per-kring "incoming policy" cache.  Receiver writes
// here on every valid kring-policy-broadcast envelope; the settings
// editor reads on mount + passes the cached doc via γ.4's
// `incomingPolicy` opt.  Same shape as the rules + recipe stores.
const kringPolicyPendingStore = createKringPolicyPendingStoreLocal();
// δ.1 — per-screen materialized-blocks cache.  The Schermen view-mode
// reads this on open to render instantly while the fresh materialize
// runs in the background; on result the view swaps + the cache
// re-saves.  Survives reboots so cold-boot users see the previous
// state immediately instead of a Loading… flash.
const screenBlocksCache = createScreenBlocksCacheLocal();
// α.3 — per-user screens store.  One book per user (not per-kring); the
// active screen drives the new Schermen tab.
const userScreenStore = createUserScreenStore({ io: localStorageScreenIo() });
const overrideStore = createMemberOverrideStore(localStorageOverrideIo());
// β.5 — pin store (single keyless map at `cc.circlePinned`).
const pinStore = createCirclePinStore(localStoragePinIo());
// Per-user pod writer — built lazily from the restored Solid session
// (`window.canopyPodSession`, set once sign-in completes below) and
// memoised. While unsigned the thunk returns null, so every store wired
// through it stays local-only (unchanged behaviour). SHARED by the
// availability pref AND the "shared with me" list (both mirror a per-user
// pod resource under `canopy/<app>/`).
let _perUserPodWriter = null;
const perUserPodWriter = () => {
  if (_perUserPodWriter) return _perUserPodWriter;
  const s = (typeof window !== 'undefined' && window.canopyPodSession) || null;
  if (!s || typeof s.fetch !== 'function' || typeof s.webid !== 'string') return null;
  try { _perUserPodWriter = createPodWriter(s); } catch { return null; }
  return _perUserPodWriter;
};
// SILENT out-of-circle delivery — per-user "shared with me" store. TIERED
// (Frits' call): localStorage (`cc.sharedWithMe`) is canonical; when a
// signed-in pod writer is present the sealed copies are mirrored to
// `canopy/cc-shared-with-me/received.json` so they SURVIVE + SYNC across the
// user's devices. Received copies land here via the peer router
// `shared-copy` handler (below); openable only with this user's own
// network-derived sealing key. Unsigned → local-only, unchanged.
const sharedWithMeStore = createSharedWithMeStore(
  tieredSharedWithMeIo(
    localStorageSharedWithMeIo(),
    podSharedWithMeIo({ getWriter: perUserPodWriter }),
  ),
);
// Objective D (Surface 3a) — availability is a device-local pref, but its
// value must be readable by other agents. Mirror it to a per-user pod
// resource via the same tiered pattern circle-policy uses.
const availabilityStore = createAvailabilityStore(
  tieredAvailabilityIo(
    localStorageAvailabilityIo(),
    podAvailabilityIo({ getWriter: perUserPodWriter }),
  ),
);
// P6.2 — persisted pending proposals (multi-admin consensus).
const proposalStore = createProposalStore({ io: localStorageProposalIo() });
// P6.10 #348 — persisted pending agent-add requests (board 4B).  Reuses
// the same {load, save} adapter shape as the proposal store.
const AGENT_REQ_STORE_KEY = 'cc.agentRequestQueue';
const agentRequestStore = createAgentRequestStore({
  io: {
    load: async (key) => {
      try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      catch { return null; }
    },
    save: async (key, value) => {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
    },
  },
  storeKey: AGENT_REQ_STORE_KEY,
});
// Cross-circle Stream (board 5B) reads this firehose; the agent's
// publishEvent appends to it during boot.
const eventLog = new EventLog({ initial: [], muted: [] });
// δ.2 — one delivery-state map per agent boot (lifetime matches the
// in-memory EventLog).  showKring's onSend marks each locally-sent
// msgId 'pending' → 'sent' | 'failed' as broadcastKringMessage
// resolves; the kring renderer reads it at render time.
const deliveryStateMap = createDeliveryStateMap();

// ε.5 — "Catching up…" indicator state + notification banner.
// Status is the latest snapshot fed by the negotiated catch-up
// receiver's `emitStatus` hook.  Notifications surface inbound
// `catch-up-request` envelopes for kringen with
// `policy.catchUpAutoApprove === false` so the host (= provider)
// gets a [Send all / Last 50 / Last 7 days / Decline] card.
let _catchUpStatus = null;          // null | {phase, circleId, count?, total?}
let _catchUpNotifications = [];     // array of pending provider-side cards
let _catchUpHideTimer = null;

function emitCatchUpStatus(status) {
  _catchUpStatus = status;
  if (_catchUpHideTimer) { clearTimeout(_catchUpHideTimer); _catchUpHideTimer = null; }
  if (status?.phase === 'done' || status?.phase === 'no-offers' || status?.phase === 'timed-out') {
    _catchUpHideTimer = setTimeout(() => { _catchUpStatus = null; renderCatchUpIndicator(); }, 1500);
  }
  // Mirror to /logs so users can debug.
  try {
    eventLog.append({
      id: `catchup-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      app: 'canopy-chat',
      type: 'notification',
      payload: { message: `[catch-up] ${status?.phase ?? '?'}` },
    });
  } catch { /* defensive */ }
  renderCatchUpIndicator();
}

function renderCatchUpIndicator() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('catch-up-indicator');
  if (!_catchUpStatus) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'catch-up-indicator';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:1000',
      'background:rgba(0,0,0,0.78)', 'color:#fff', 'padding:6px 10px',
      'border-radius:12px', 'font-size:12px', 'font-family:system-ui,sans-serif',
      'box-shadow:0 2px 6px rgba(0,0,0,0.2)',
    ].join(';');
    document.body.appendChild(el);
  }
  const s = _catchUpStatus;
  let label;
  if (s.phase === 'streaming' && Number.isFinite(s.total) && s.total > 0) {
    label = t('circle.chat.catch_up.streaming_progress', { count: s.count ?? 0, total: s.total });
  } else if (s.phase === 'done') {
    label = t('circle.chat.catch_up.done');
  } else if (s.phase === 'no-offers') {
    label = t('circle.chat.catch_up.no_offers');
  } else {
    label = t('circle.chat.catch_up.requesting');
  }
  el.textContent = label;
}

function emitCatchUpNotification(n, providerHandle) {
  _catchUpNotifications.push({ n, provider: providerHandle });
  try {
    eventLog.append({
      id: `catchup-req-${n.requestId}`,
      ts: Date.now(),
      app: 'canopy-chat',
      type: 'notification',
      payload: {
        message: t('circle.chat.catch_up.provider_request_title', {
          name: n.fromPeerAddr.slice(0, 12), kring: n.groupId,
        }) + ' · ' + t('circle.chat.catch_up.provider_request_size', {
          count: n.count, kb: Math.round(n.sizeBytes / 1024) || 1,
        }),
      },
    });
  } catch { /* defensive */ }
  renderCatchUpNotifications();
}

function renderCatchUpNotifications() {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('catch-up-notifications');
  if (_catchUpNotifications.length === 0) {
    if (host) host.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'catch-up-notifications';
    host.style.cssText = [
      'position:fixed', 'bottom:8px', 'right:8px', 'z-index:1001',
      'display:flex', 'flex-direction:column', 'gap:6px',
      'max-width:340px', 'font-family:system-ui,sans-serif',
    ].join(';');
    document.body.appendChild(host);
  }
  host.innerHTML = '';
  for (const { n, provider } of _catchUpNotifications) {
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border:1px solid #ccc', 'border-radius:8px',
      'padding:10px', 'box-shadow:0 2px 6px rgba(0,0,0,0.18)', 'font-size:13px',
    ].join(';');
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = t('circle.chat.catch_up.provider_request_title', {
      name: n.fromPeerAddr.slice(0, 12), kring: n.groupId,
    });
    const size = document.createElement('div');
    size.style.color = '#555';
    size.style.margin = '4px 0 8px';
    size.textContent = t('circle.chat.catch_up.provider_request_size', {
      count: n.count, kb: Math.round(n.sizeBytes / 1024) || 1,
    });
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const mkBtn = (label, mode) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid #888;background:#f4f4f4;cursor:pointer;font-size:12px;';
      b.addEventListener('click', () => {
        provider.resolveCatchUpRequest({ requestId: n.requestId, mode }).catch(() => {});
        _catchUpNotifications = _catchUpNotifications.filter((x) => x.n.requestId !== n.requestId);
        renderCatchUpNotifications();
      });
      return b;
    };
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_all'),       'all'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_last_50'),   'last-50'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_send_last_7d'),   'last-7-days'));
    btnRow.appendChild(mkBtn(t('circle.chat.catch_up.provider_decline'),         null));
    card.appendChild(title);
    card.appendChild(size);
    card.appendChild(btnRow);
    host.appendChild(card);
  }
}

let rootEl = null;
let tabBarEl = null;
let circlesCache = [];
let sources = {};
let resolveCallSkill = null; // (opId, args) => Promise<object|null>
let rawCallSkill = null;     // (appOrigin, opId, args) — for createGroupV2
// The pod-session's AUTHED fetch (set on sign-in) — lets embed-ref resolution
// read the user's OWN private-pod items; null when signed out → resolution falls
// back to a public fetch (only public cross-pod refs resolve; protected → 🔒).
let circleAuthedFetch = null;
let circleOwnerWebId = null;   // signed-in webid — owner of the ACP grants for sealed circles
// S6.4 — the active circle's noticeboard reloader, so a stoop:attachment-fetched
// event (recipient's full bytes arrived) can refresh whatever board is on screen.
let noticeboardRefreshHook = null;

// ── Phase 5 — circle bot + feedback in the kring composer ───────────────────────────────────────
// Mirrors mobile CircleLauncherScreen on the SHARED engine: createCircleDispatch (gate→interpret→
// dispatch) + createClarifyingDispatch (label→id) + makeCircleLookup (live fetch) + the token gate +
// createFeedbackMount. Built once post-agent-boot (buildCircleBot). The bot/feedback render INTO the
// kring stream via `_kringRender`, a small per-circle bridge that showKring sets each time it opens.
const CIRCLE_LLM_BASEURL   = import.meta.env?.VITE_CIRCLE_LLM_BASEURL ?? null;
const CIRCLE_LLM_MODEL     = import.meta.env?.VITE_CIRCLE_LLM_MODEL ?? undefined;
// Per-call LLM timeout. The provider's 12s default is fine for a fast cloud/enclave model
// but aborts a local model's cold-start (qwen2.5:7b warms up in 30–60s) → the bot silently
// drops to "basic mode". Default generous (90s) for the local case; override via env.
const CIRCLE_LLM_TIMEOUT_MS = Number(import.meta.env?.VITE_CIRCLE_LLM_TIMEOUT_MS ?? 90000) || 90000;
// F-retrieve tier-2 embeddings — defaults to the LLM base (the enclave serves both
// /v1/chat/completions + /v1/embeddings), so semantic RAG rides the same trust
// boundary unless explicitly pointed elsewhere. Model defaults to the provider's
// (qwen3-embedding-4b) when unset; null base → semantic stays inert (tier-1 lexical).
const CIRCLE_EMBED_BASEURL = import.meta.env?.VITE_CIRCLE_EMBED_BASEURL ?? CIRCLE_LLM_BASEURL;
const CIRCLE_EMBED_MODEL   = import.meta.env?.VITE_CIRCLE_EMBED_MODEL ?? undefined;
// Bearer key for an OpenAI-compatible gateway behind the LLM/embed base — notably
// the Privatemode loopback proxy's project key. Unset → local Ollama (no auth).
// Embeddings default to the same key (same enclave serves chat + /v1/embeddings).
const CIRCLE_LLM_APIKEY    = import.meta.env?.VITE_CIRCLE_LLM_APIKEY ?? null;
const CIRCLE_EMBED_APIKEY  = import.meta.env?.VITE_CIRCLE_EMBED_APIKEY ?? CIRCLE_LLM_APIKEY;
// T3a — optional relay (ws://|wss://). When set, the agent connects relay ALONGSIDE NKN and the
// RoutingStrategy picks the best route per peer (relay > nkn). Unset → NKN-only (unchanged).
// In-app override: the relay URL set in Settings → Mij wins over the env var, so the relay is
// configurable without a rebuild. localStorage is sync, so resolve it here at module-init — before the
// boot-time tryConnectPeerTransport reads it. Empty setting ⇒ env fallback. `applyRelayUrl` reconnects live.
const CIRCLE_RELAY_ENV     = import.meta.env?.VITE_CIRCLE_RELAY_URL ?? null;
const relayPrefStore       = createRelayPrefStore(localStorageRelayIo());
let   CIRCLE_RELAY_URL      = resolveRelayUrl(localStorageRelayIo().load(), CIRCLE_RELAY_ENV);
let   _peerAgent           = null;   // captured at boot so a relay-setting change can reconnect live
let   _peerRouter          = null;
const CIRCLE_BOT_NAME      = import.meta.env?.VITE_CIRCLE_BOT_NAME ?? 'assistant';
const CIRCLE_LLM_POLICY    = import.meta.env?.VITE_CIRCLE_LLM_POLICY ?? 'user';
// Theme B — the settings-chatbot template. HQ can host an updated (open-source)
// one at this URL; we fall back to the bundled DEFAULT_SETTINGS_TEMPLATE.
const SETTINGS_TEMPLATE_URL = import.meta.env?.VITE_SETTINGS_TEMPLATE_URL ?? null;
let settingsTemplate = DEFAULT_SETTINGS_TEMPLATE;
loadSettingsTemplate({ url: SETTINGS_TEMPLATE_URL }).then((tpl) => { settingsTemplate = tpl; }).catch(() => { /* keep bundled */ });
const FEEDBACK_LLM_BASEURL = import.meta.env?.VITE_FEEDBACK_LLM_BASEURL ?? undefined;
const FEEDBACK_LLM_MODEL = import.meta.env?.VITE_FEEDBACK_LLM_MODEL ?? undefined;   // the model the route serves (default qwen2.5 404s on Privatemode)
// cluster J — feedback real-pod activation env (parity with classic main.js' VITE_FEEDBACK_*).
const FEEDBACK_ACTIVATION_URL = import.meta.env?.VITE_FEEDBACK_ACTIVATION_URL ?? null;
const FEEDBACK_PROJECT_ID = import.meta.env?.VITE_FEEDBACK_PROJECT_ID ?? 'canopy-chat';
// cluster J — ADDED feedback bots (no pre-seeding): the portal invite link/QR adds a co-hosted fp-bot
// contact; tapping it opens its dedicated thread + activates the verify pods.
const feedbackBotStore = createFeedbackBotStore(typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} });
const _fbThreads = new Map();   // botId → { name, messages:[], surface, mount, activated }
let _activeFbThread = null;     // { botId }
let circleBot = null;            // createCircleDispatch instance (handle(text, ctx) → {via,cmd})
let circleFeedbackMount = null;  // createFeedbackMount (tryHandle(text, threadId))
let circleClarify = null;        // createClarifyingDispatch (for candidate-button picks, later)
let circleCatalog = null;        // the merged dispatch catalog (built in buildCircleBot) — feeds the composer slash-suggest
let circleBaseSources = [];      // B · Slice 2/4 — the merged manifest sources (module-scoped so showSettings/showOverride can build the settings form + freedom matrix)
let circleManifestsByOrigin = {}; // B · Slice 3 — {appOrigin → manifest}, module-scoped for the list-screen panel's row actions

// D-mig-1b — the declared list-screen surfaces (contacts + prikbord) are now
// projected FROM the composed manifests: openCircleScreenPanel resolves each
// screen's config (appOrigin / fetch skill / label + category field) via
// `sectionForScreen(circleManifestsByOrigin, screenId)` over renderWeb's
// NavModel.sections[] — no hardcoded screen literal remains.
let circleActiveApps = null;     // S6.C deep — the active circle's policy.apps (null = all); narrows the catalog
let circleRescopeCatalog = null; // re-scope the catalog to circleActiveApps (set in buildCircleBot, called by showKring)
let circleDispatchReady = null;  // buildCircleBot's dispatchReady({opId,args}) — used to run a completed follow-up
let circleApplyUserLlm = null;   // (cfg) => {ok,mode}|{ok:false,error} — rebuild the live LLM/embed providers from the member's settings
let circleEmbedButtonTap = null; // S6.A — dispatch an inline embed button {opId,itemId} from a bot reply
let circleSyncFolioNoteEmbedder = null; // 52.25 — re-wire folio /zoek's embedder from the active circle's embed policy
// S6.C — per-user surface preference (inline / screen / minimal); hydrated at boot.
const circleSurfacePref = createSurfacePrefStore(localStorageSurfacePrefIo());
let circleContactSkills = null;  // P4 — live contact/bot exposed-skill registry (subscribed to agent.peers)
let circlePeerGraph = null;      // P5 — app-owned PeerGraph (contacts roster + P4 registry source)
let circleCoreAgent = null;      // P5 — the core chat agent (agent.sa.agent), for discoverA2A
let circleHouseholdAgent = null; // OBJ-2 — the real household agent (createRealHouseholdAgent); module-level
                                 // so showSettings (a sibling fn, NOT nested in buildCircleBot) can read its
                                 // no-pod sync hooks (householdSelfAddr / addHouseholdPeer). Was referenced
                                 // as a free `agent` → ReferenceError that broke web Circle Settings entirely.
let circleContactChannel = null; // P5 — contact-thread peer channel (conversational link over sa.peer)
// OBJ-2 membership — peer-redeem correlation (joiner side) + the sender, set when the agent boots.
const circlePendingRedeems = new Map();  // requestId → {resolve,reject,timer}
let circleSendPeerRedeem = null;         // makeSendGroupRedeemRequest(...) bound to this agent
// OBJ-2 S1c-shell — feed the household no-pod sync roster with a circle's MEMBERS
// (people, from the stoop group roster — never bots). Assigned in the boot fn
// (which owns `agent`); module-level so `showDetail` (open-circle) can call it.
let feedHouseholdRosterForCircle = null;
// S4 — a dedicated vault for per-circle sealing identities + controller keys + the
// persisted group-key resource (durability). IndexedDB-backed so a sealed circle's keys
// survive reloads; falls back to in-memory where IndexedDB is unavailable.
const circleVault = (() => {
  try { return new VaultIndexedDB({ dbName: 'cc-circle-pod' }); }
  catch { return new VaultMemory(); }
})();
const circlePods = new Map();    // S4 — circleId → per-circle pod producer (sealing identity + control agent)
let circleRealPodRouting = null; // S4 circle OIDC — set when signed in; routes sealed circles to the real pod
const circleSealStrategies = new Map();   // S4 — circleId → resolved {seal,open} content strategy (or null for p0/p1)
// S4 — routes stoop membership events (redeem/leave) to the joined circle's producer, so
// a new member's sealing key is wrapped into that circle's group key (multi-member sealing).
// V0: routes to a LIVE producer (circle opened on this device); seeding from prior redemptions
// is a follow-up. Passed to the single stoop agent as its `controlAgent`.
const circleControlAgentRouter = createCircleControlAgentRouter((id) => circlePods.get(id) ?? null);

/**
 * S4 — resolve (and cache) a circle's CONTENT seal/open strategy. For a sealed (p2/p3)
 * circle this is the producer's control-agent strategy unwrapped with the local device's
 * own per-circle sealing identity (a recipient of the group key). p0/p1 → null (plaintext).
 */
async function getCircleSealStrategy(circleId, policy) {
  if (circleSealStrategies.has(circleId)) return circleSealStrategies.get(circleId);
  let strat = null;
  try {
    const prod = await ensureCirclePod(circleId, policy);
    if (prod?.controlAgent && prod.sealingIdentity) {
      const idKey = await prod.sealingIdentity.ensure();
      strat = await prod.controlAgent.sealingStrategy(idKey.privateKey);
    }
  } catch { strat = null; }
  circleSealStrategies.set(circleId, strat);
  return strat;
}

/** S4 — a pseudo-pod client for one circle (real per-circle sealed storage, no OIDC/CSS). Objective L:
 * the backend is browser-persistent (IndexedDB, scoped per circle) so the circle's items survive a
 * reload; falls back to in-memory under SSR / tests (no `indexedDB`) — see `pickWebBackend`. */
function makeCirclePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: pickWebBackend(`cc-circle-${circleId}`), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/**
 * S4 — ensure a per-circle pod producer exists (idempotent, keyed by circle id). For a
 * sealed posture (p2/p3) this stands up a real per-circle control agent over the circle's
 * own in-memory pod; p0/p1 get just a sealing identity. Best-effort: never blocks circle
 * load (a missing vault / pod machinery just skips, leaving the plain shared path).
 */
async function ensureCirclePod(circleId, policy) {
  if (!circleId || !circleVault || circlePods.has(circleId)) return circlePods.get(circleId) ?? null;
  const storagePosture = policy?.storagePosture ?? 'p0';
  // Circle OIDC: when signed in, route a sealed circle to the user's REAL pod; else the
  // in-memory pseudo-pod (offline / not signed in). Verified end-to-end in circlePodProducer.css.test.js.
  const routing = circleRealPodRouting;
  try {
    // On a REAL pod (signed in), wire a real ACP `sharing` so a member redeem grants
    // them pod read of the circle container — true multi-device. (Pseudo-pod keeps
    // the no-op: no ACL layer.) Verified on two CSS pods in circlePod2Pod.css.test.js.
    const sharing = (routing && circleAuthedFetch && circleOwnerWebId)
      ? createCirclePodSharing({ fetch: circleAuthedFetch, ownerWebId: circleOwnerWebId })
      : undefined;
    const producer = await createCirclePodProducer({
      circleId, storagePosture, vault: circleVault, generateKeypair: podGenerateKeypair,
      makePodClient: routing ? routing.makePodClient : makeCirclePodClient,
      circleRootUri: routing ? routing.circleRootUri(circleId) : undefined,
      sharing,
    });
    circlePods.set(circleId, producer);
    return producer;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circleApp] ensureCirclePod failed:', err?.message ?? err);
    return null;
  }
}
// P5 — per-contact DM thread state: contactId → { name, peerAddr, messages:[{origin,text,buttons?,pending?}] }.
const contactThreads = new Map();
let _activeContactThread = null; // { contactId, rerender } — set while a DM thread is on screen
let circlePendingFollowUp = null;// a single-field needsForm awaiting the user's next message (conversational elicitation)
let circlePendingFormFollowUp = null; // a 2+-field needsForm → inline multi-field form (mobile parity); cleared on submit
// The bot asked a free-text QUESTION (an llm-reply containing '?') — route the user's NEXT line back to it
// (no '@assistant' needed) with the prior exchange threaded as conversation, so a bare answer resolves.
let circleAwaitingBotReply = null;   // {question, query} | null
function noteCircleBotTurn(r, query) {
  const reply = r && r.via === 'llm-reply' && typeof r.reply === 'string' ? r.reply.trim() : '';
  circleAwaitingBotReply = reply && /\?/.test(reply) ? { question: reply, query: String(query || '') } : null;
}
let _kringRender = null;         // { circleId, botBubble(text), fanOut(msgId,text,ts) } — set by showKring
let _clarifyScope = null;        // scope of the last clarify ask(), so a candidate button taps pick() on it
let _lastKringListing = null;    // { appOrigin, items } from the most-recent list reply, for bulk "/done all"
const _fileShareInbox = new Map();   // fileId → {name,mime,dataB64,size} of a received peer file, for [Download]

// Turn an inline base64 file body (from a received file-share) into a real browser download.
function triggerBlobDownloadFromBase64(dataB64, name, mime) {
  const bin = atob(dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name || 'file'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
// One bash-style command history for the kring composer, module-level so it survives showKring re-renders
// (the classic shell keeps a single global history too). Web↔mobile parity via the shared helper.
const kringInputHistory = createInputHistory();

// (kringReplyText is now the shared `src/v2/kringReply.js` — verb-aware Added:/Completed: phrasing.)

// Build the bot + feedback once the agent is up (rawCallSkill bound). Stores into the module vars above.
// F-retrieve persistence: one app-level StorageBackend for the circle-bot RAG
// vector index. The retriever scopes it per-circle to
// private/state/search-index/circle-rag/<circleId>/ (never sharing/ — invariant
// #7). Same @canopy/pseudo-pod substrate the circle pods run on. Objective L:
// browser-PERSISTENT (IndexedDB) so embedded vectors survive a reload instead of
// re-embedding; falls back to in-memory under SSR / tests (no `indexedDB`).
const circleSearchVectorStore = pickWebBackend('cc-circle-rag');

function buildCircleBot(agent) {
  // Merged catalog (the LLM tool list + dispatch catalog) — mirrors main.js.
  const baseSources = [
    { manifest: canopyChatManifest },
    // tasks-v0 BEFORE the household agent: a circle's items are TASKS, so colliding bare op-ids
    // (notably `addTask`, declared by both) must resolve to tasks-v0, not household chores — matching
    // the circle GATE which already excludes household ("household shadowed by tasks", circleGate.js).
    // Without this, "@assistant add X" landed in the household circle while the complete-resolver/lookup
    // (tasks-v0) found nothing → "couldn't find X in this circle" on `done X` (#49).
    { manifest: mockTasksManifest },
    { manifest: agent.manifest },
    { manifest: mockStoopManifest },
    { manifest: mockFolioManifest },
    { manifest: calendarManifest },
  ];
  circleBaseSources = baseSources;   // B · Slice 2/4 — expose to the module-level showSettings/showOverride
  let rawCatalog = mergeManifests(baseSources, { runtime: 'browser' });
  // S6.A — manifests keyed by appOrigin, for computing inline embed buttons on
  // bot replies (computeEmbedButtons looks ops up here by the op's appOrigin).
  const manifestsByOrigin = {};
  for (const s of baseSources) {
    const m = s.manifest; if (!m) continue;
    if (m.app)   manifestsByOrigin[m.app] = m;
    if (m.appId) manifestsByOrigin[m.appId] = m;
  }
  circleManifestsByOrigin = manifestsByOrigin;   // B · Slice 3 — expose to the module-level list-screen panel
  const appRegistry = new AppRegistry();
  appRegistry.syncWithCatalog(rawCatalog.appOrigins);
  // Scope to the circle apps (Part D) — drops canopy-chat's account/transport INFRA ops (`/me` etc.) that
  // the circle bot can't actually run (they threw `circle.bot.failed` when dispatched, 2026-06-12) and
  // keeps them out of the slash-suggest dropdown. Default scope = the 5 circle apps (DEFAULT_CIRCLE_ORIGINS).
  // Extension-mapping origins (the mapping ids) are added to the allowed scope so their merged ops survive
  // scoping — DEFAULT_CIRCLE_ORIGINS alone would drop them. (V0: treat all accepted mappings as app-scoped;
  // per-circle scope is a later refinement.)
  let mappingOrigins = [];
  const mappingsStore = localStorageMappingsStore();   // V0 web store; swap for a pseudo-pod at P3 3.3c
  // S6.C deep — base scope = the 5 circle apps (+ accepted extension mappings); the
  // active circle's policy.apps narrows it further (intersection), so a circle can
  // compose only the apps it uses. null/empty policy.apps → all (no dead circles).
  const allowedApps = () => {
    const base = [...DEFAULT_CIRCLE_ORIGINS, ...mappingOrigins];
    if (Array.isArray(circleActiveApps) && circleActiveApps.length) {
      const want = new Set(circleActiveApps);
      const scoped = base.filter((a) => want.has(a));
      if (scoped.length) return scoped;
    }
    return mappingOrigins.length ? base : undefined;   // undefined → scopeCatalogToApps uses DEFAULT_CIRCLE_ORIGINS
  };
  let catalog = scopeCatalogToApps(filterCatalog(rawCatalog, appRegistry), allowedApps());
  circleCatalog = catalog;        // expose to showKring's composer (slash-suggest)
  const rescopeCatalog = () => { catalog = scopeCatalogToApps(filterCatalog(rawCatalog, appRegistry), allowedApps()); circleCatalog = catalog; };
  circleRescopeCatalog = rescopeCatalog;   // S6.C — showKring calls this on circle-open to apply policy.apps
  appRegistry.subscribe(rescopeCatalog);
  // Extension mappings (feedback-extension P2c) — scanned from the V0 localStorage store, verified against the
  // base catalog (sandbox-by-construction: a mapping referencing an unknown opId is refused), then merged in +
  // re-scoped. Best-effort: extensions never block boot. Callable so an install can refresh the catalog. Swap the
  // store for a real pseudo-pod when the web pod layer (P3 3.3c) lands — `loadMappings` is store-agnostic.
  async function loadAndMergeMappings() {
    try {
      const { mappings } = await loadMappings({ pseudoPod: mappingsStore, deviceId: WEB_MAPPINGS_DEVICE });
      const { accepted } = verifyMappings(mappings, rawCatalog);
      const { sources } = mappingsToSources(accepted);
      if (!sources.length) return;
      mappingOrigins = sources.map((s) => s.manifest.app);
      rawCatalog = mergeManifests([...baseSources, ...sources], { runtime: 'browser' });
      appRegistry.syncWithCatalog(rawCatalog.appOrigins);
      rescopeCatalog();
    } catch { /* extensions are best-effort — a bad store/mapping must not break the kring */ }
  }
  loadAndMergeMappings();

  // Install entry (P2c-3) — open a link/paste → plain consent card → on Add writeMapping + refresh the catalog.
  // Accepts a Mapping object, a JSON string, or a base64-encoded JSON string (a `?install=` link).
  async function installExtensionFromLink(input) {
    let mapping = input;
    if (typeof input === 'string') {
      const s = input.trim();
      try { mapping = JSON.parse(s.startsWith('{') ? s : atob(s)); } catch { return; }
    }
    if (!mapping || typeof mapping !== 'object') return;
    const result = buildConsentModel(mapping, rawCatalog);
    showConsentCard(result, {
      onAdd: async () => {
        const r = await installMapping({ store: mappingsStore, deviceId: WEB_MAPPINGS_DEVICE, mapping, catalog: rawCatalog });
        if (r.ok) await loadAndMergeMappings();
      },
    });
  }
  if (typeof window !== 'undefined') {
    window.canopyInstallExtension = installExtensionFromLink;   // manual / programmatic install
    try {
      const enc = new URLSearchParams(window.location.search).get('install');
      if (enc) installExtensionFromLink(enc);                   // ?install=<base64 mapping JSON>
    } catch { /* no install param */ }
  }

  // P4 (feedback-extension) — contact/bot exposed skills, LIVE. A bot discovered
  // via `agent.discoverA2A` lands in `agent.peers` with its skills already as
  // SkillCards; the registry subscribes to that PeerGraph and, per bot, synthesises
  // a contact-thread catalog + a router that hands a dispatch to the bot over A2A
  // (`sendA2ATask` → await the Task's result). It is kept SEPARATE from the circle
  // catalog (contact ops are contact-thread-scoped, not app-scoped), so it never
  // pollutes the circle bot's command pool. The contact-thread VIEW that renders a
  // bot's commands in its own DM thread is P5/P6; this wiring makes the bridge live
  // + drivable now (`window.canopyContactSkills` for the view + e2e).
  const sendContactTask = async (peerUrl, skillId, args) => {
    const task = sendA2ATask(agent, peerUrl, skillId, args);
    const { parts } = await task.done();
    return { parts };
  };
  // canopy-chat's secure-agent doesn't maintain a core PeerGraph (peers are
  // tracked in stoop membership, not core discovery), so the contacts registry
  // is APP-OWNED: one PeerGraph the roster + the P4 skill registry read, populated
  // as bots/peers are discovered (discoverA2A) or added. The agent stays the
  // transport (sendPeerMessage). (Ideally the secure-agent owns this so gossip/
  // discovery feed it directly — a follow-up; app-owned is correct + sufficient
  // here since canopy-chat drives population explicitly.)
  // Persist the roster to localStorage so v2 Contacten survives a reload
  // (it was in-memory and vanished on refresh). PeerGraph reads through the
  // backend, so a fresh graph over the same store rehydrates automatically.
  circlePeerGraph = new PeerGraph({ storageBackend: createLocalStoragePeerBackend() });
  circleCoreAgent = agent.sa?.agent ?? null;   // the core chat agent — discoverA2A's hello/native-upgrade target
  if (typeof window !== 'undefined') {
    window.canopyCirclePods = circlePods;   // S4 debug / e2e seam
    // e2e: drive a producer for any posture (verifies browser-safe sealing crypto end-to-end).
    window.canopyMakeCirclePod = (circleId, storagePosture = 'p2', roster = []) =>
      createCirclePodProducer({ circleId, storagePosture, vault: circleVault, roster,
        generateKeypair: podGenerateKeypair, makePodClient: makeCirclePodClient });
    window.canopySealingKit = { generateKeypair: podGenerateKeypair, createSealedPodClient, scopeStoopCallSkill };
  }
  circleContactSkills = createContactSkillRegistry({ peerGraph: circlePeerGraph, sendTask: sendContactTask });
  circleContactSkills.start().catch(() => { /* discovery is best-effort — never blocks the kring */ });
  if (typeof window !== 'undefined') window.canopyContactSkills = circleContactSkills;

  // P5 — the conversational channel (the client end of the bot peer link). The
  // channel sends over agent.sendPeerMessage, which routes through core
  // RoutingStrategy (mdns > rendezvous > relay > nkn), so a DM turn reaches the
  // bot over whichever transport is live. Inbound replies are routed by
  // `channel.replyHandler` registered in the peer router (below).
  circleContactChannel = createContactThreadChannel({
    sendToPeer: (addr, payload) =>
      (typeof agent.sendPeerMessage === 'function'
        ? agent.sendPeerMessage(addr, payload)
        : Promise.reject(new Error('agent.sendPeerMessage unavailable'))),
  });
  if (typeof window !== 'undefined') {
    window.canopyContactChannel = circleContactChannel;
    window.canopyPeers = circlePeerGraph;   // debug / e2e seam (roster + journey-A tests seed/inspect peers)
    window.canopyAddBot = addBotFromInput;  // manual / programmatic add
    try {
      const params = new URLSearchParams(window.location.search);
      const addbot = params.get('addbot');
      if (addbot) addBotFromInput(addbot);  // ?addbot=<https url | peer address>
      // cluster J — a feedback invite link (?projectId=…&code=…) IS the add-a-bot action: it adds the
      // feedback bot, then Contacten shows it (tap → its dedicated thread + activation). No pre-seeding.
      if (params.get('projectId') && params.get('code')) addBotFromInput(window.location.search);
    } catch { /* no addbot / invite param */ }
  }

  // Deployment env config = the FALLBACK when the member hasn't set their own endpoint in settings.
  // The embed route defaults to the LLM base (the enclave hosts both /v1/chat/completions +
  // /v1/embeddings) so semantic RAG rides the SAME trust boundary by default; null → semantic inert.
  const ENV_LLM = {
    mode: CIRCLE_LLM_BASEURL ? 'local' : 'off',
    llmBaseUrl: CIRCLE_LLM_BASEURL, llmModel: CIRCLE_LLM_MODEL, llmApiKey: CIRCLE_LLM_APIKEY,
    embedBaseUrl: CIRCLE_EMBED_BASEURL, embedModel: CIRCLE_EMBED_MODEL, embedApiKey: CIRCLE_EMBED_APIKEY,
    timeoutMs: CIRCLE_LLM_TIMEOUT_MS,
  };
  // LIVE provider objects the bot holds by reference — applyUserLlmRuntime mutates them in place so a
  // settings change takes effect without a reload. Seeded from env; the member's saved config overrides.
  const llmProviders = {};
  const embedProviders = {};
  applyUserLlmRuntime({ userCfg: { preset: 'off' }, env: ENV_LLM, llmProviders, embedProviders });
  let userDefault = { mode: ENV_LLM.mode };
  const userLlmStore = createUserLlmDefaultStore(localStorageUserLlmIo());
  // Exposed to the settings panel (showMyData): rebuild the live providers from the member's config.
  circleApplyUserLlm = (cfg) => {
    const r = applyUserLlmRuntime({ userCfg: cfg, env: ENV_LLM, llmProviders, embedProviders });
    if (r.ok) userDefault = { ...cfg, mode: r.mode };
    // 52.25 — the embed providers just changed → re-wire folio /zoek's embedder.
    try { circleSyncFolioNoteEmbedder?.(); } catch { /* /zoek stays lexical */ }
    return r;
  };
  // Apply the member's saved endpoint config at boot (falls back to env when unset).
  userLlmStore.get().then((v) => { circleApplyUserLlm(v); }).catch(() => {});
  // Per-turn embedder resolution for the circle RAG retriever: rides the circle's
  // embed policy (embedTool ?? llmTool), reusing the SAME resolution folio /zoek
  // uses (`resolveCircleEmbedder` over the live `embedProviders`). Returns the
  // resolved `EmbeddingClient` OBJECT (the PodSearch-backed retriever normalises
  // it — `{model}` → `{id}`), or `null` when off/unconfigured → the hybrid index
  // degrades to LEXICAL-only with NO embed call (invariant #7 + llmTool gate).
  const resolveCircleRagEmbedder = async () => {
    try { return resolveCircleEmbedder({ circlePolicy: await policyFor(), userDefault, providers: embedProviders }) || null; }
    catch { return null; }
  };
  const policyIo = localStoragePolicyIo();
  async function policyFor() {
    const cid = getActiveCircle();
    if (!cid) return { llmTool: CIRCLE_LLM_POLICY };
    let raw = null;
    try { raw = await policyIo.load(cid); } catch { /* defaults */ }
    return { llmTool: raw && typeof raw.llmTool === 'string' ? raw.llmTool : CIRCLE_LLM_POLICY };
  }

  // Feedback — bubbles render into the kring stream (the mount wraps a surface; appendBotBubble routes
  // to the current kring's botBubble). appendUserBubble ECHOES the user's line (matches mobile): in this
  // composer the feedback mount gets first refusal BEFORE the optimistic append, so without this the
  // user's feedback messages vanished until /feedback-stop (2026-06-12). The echo is local-only (not
  // fanned out to peers), so a private feedback message isn't broadcast to the circle.
  const feedbackSurface = createFeedbackSurface({
    llmBaseURL: FEEDBACK_LLM_BASEURL,
    llmModel: FEEDBACK_LLM_MODEL,
    // General in-chat bot menus: pass the bot's buttons through as `action` callbacks (routed by source in
    // circleEmbedButtonTap). Feedback's PRIMARY surface is the dedicated fp-bot thread, but if it's used
    // in-kring its consent/verify buttons render here too (no longer dropped).
    emit: ({ text, buttons }) => {
      const acts = (buttons || []).map((b) => ({ action: b.id, label: b.label }));
      if (text || acts.length) _kringRender?.botBubble(text || '', acts.length ? { buttons: acts } : undefined);
    },
  });
  circleFeedbackMount = createFeedbackMount({
    surface: feedbackSurface,
    appendUserBubble: (_tid, text) => { if (text) _kringRender?.userBubble(text); },
    appendBotBubble:  (_tid, text) => _kringRender?.botBubble(text),
  });

  // Live, app-qualified label→candidate lookup (no preloaded base here — the kring stream isn't an item
  // list; the live fetch + the op's appOrigin do the work, scoped to the active circle).
  const lookup = makeCircleLookup({ getBase: () => [], appCallSkill: rawCallSkill, scopeId: () => getActiveCircle() });

  // Run a fully-resolved {opId,args} against the catalog, scoped to the active circle, then post a reply.
  async function dispatchReady({ opId, args, appOrigin }) {
    let route;
    try { route = resolveDispatch({ kind: 'slash', opId, args: args || {}, appOrigin, command: '(bot)', body: '' }, catalog); }
    catch { _kringRender?.botBubble(t('circle.bot.unknown')); return; }
    if (route.kind === 'needsForm') {
      // Conversational elicitation (chat-native, parity with mobile): a single missing field → ask for
      // it in the kring and capture the user's NEXT message (onSend's pending-follow-up branch).
      const pending = beginFollowUp({ dispatch: route, t });
      if (pending) { circlePendingFollowUp = pending; _kringRender?.botBubble(pending.promptText); return; }
      // 2+ missing fields → render an inline multi-field form (mobile's MultiFieldFormBubble parity), on
      // the shared followUp.js. The host owns the pending state; renderCircleKring draws the form and
      // onFormSubmit completes the dispatch. rerender() so the form appears immediately.
      const form = beginFormFollowUp({ dispatch: route, t });
      if (form) { circlePendingFormFollowUp = form; _kringRender?.rerender(); return; }
      // Neither single nor multi (e.g. no missing param names) → the simple "needs more info" bubble.
      _kringRender?.botBubble(t('circle.bot.needsInfo'));
      return;
    }
    if (route.kind !== 'ready')     { _kringRender?.botBubble(t('circle.bot.unknown')); return; }
    // B · Slice 1 — DEFAULT-DENY capability gate. Every user-initiated dispatch (slash/LLM/gate/
    // button/follow-up) converges here; internal plumbing calls rawCallSkill directly and is untouched.
    // This closes the leak where the SCREEN button was app-gated (isOpAppEnabledForActiveCircle) but the
    // dispatch itself was not — an op could still run when invoked directly.
    const denyCode = await circleCapabilityDeny(route.appOrigin, route.opId, route.args);
    if (denyCode) {
      _kringRender?.botBubble(t(denyCode === 'app-disabled' ? 'circle.gate.appDisabled' : 'circle.gate.capabilityDenied'));
      return;
    }
    let reply;
    try { reply = await runDispatch(scopeReadyDispatch(route, getActiveCircle()), rawCallSkill); }
    catch (e) { _kringRender?.botBubble(t('circle.bot.failed', { msg: e?.message ?? String(e) })); return; }
    // The op's verb drives Added:/Completed: phrasing (a bare "✓ X" was identical for add + complete).
    const entry = catalog?.opsById?.get(route.opId);
    const verb = entry?.op?.verb;
    // S6.A — manifest-driven inline buttons for the item(s) this reply carries
    // (Claim / Mark complete / RSVP …), gated by appliesTo. Ride payload.buttons.
    // B · Slice 4 (4c) — grey/hide inline affordances per the member's effective capability + consequence.
    let capMatrix = [];
    try {
      const cid = getActiveCircle();
      if (cid) {
        const pol = (await policyStore.get(cid)) ?? {};
        const ovr = (await overrideStore.get(cid)) ?? {};
        capMatrix = buildCapabilityMatrix(baseSources, {
          enabledApps: Array.isArray(pol.apps) && pol.apps.length ? pol.apps : null,
          template: pol.capabilities || {}, optOuts: ovr.capabilityOptOuts || [],
        });
      }
    } catch { /* best-effort — no greying on error */ }
    const inlineButtons = embedButtonsForReply({ reply, appOrigin: entry?.appOrigin, manifestsByOrigin, capabilityMatrix: capMatrix });
    // S6.B — if the dispatched op declares a screen surface (surfaces.ui.screen),
    // prepend an "Open …" button that opens a panel instead of dispatching.
    const screen = entry?.op?.surfaces?.ui?.screen;
    const screenButton = screen
      ? [{ id: `screen:${screen}`, screen, label: t(`circle.screen.open.${screen}`, { defaultValue: t('circle.screen.open_generic') }) }]
      : [];
    // S6.C (per-circle) — gate the dedicated SCREEN surface by the circle's
    // policy.features (the existing tab gate, now also covering the chat "open a
    // screen" affordance): a circle with tasks/calendar OFF offers no task/agenda
    // panel. Inline action buttons stay — they're a contextual response to an op
    // the user explicitly invoked. Core apps (stoop/household) are ungated.
    const appEnabled = await isOpAppEnabledForActiveCircle(entry?.appOrigin);
    const gatedScreen = appEnabled ? screenButton : [];
    // S6.C (per-user) — the user's preference picks the projection (inline / screen / minimal).
    const buttons = selectSurfaceButtons({ inlineButtons, screenButton: gatedScreen, pref: circleSurfacePref.get() });
    // Scope: a mutating op's reply reaches the whole kring (the action is shared); a
    // read/info reply or an error is private to you. (messageScope.js)
    const scope = scopeForReply({ verb, error: !!reply?.error });
    // embeds[] — the bot reply REFERENCES the item it just acted on (the created
    // task / event), so the bubble shows a "See also" chip linking to it. Title
    // is taken from the reply → no resolution needed.
    const embeds = embedsFromReply(reply, { appOrigin: entry?.appOrigin });
    _kringRender?.botBubble(kringReplyText(reply, { verb, t }), { buttons, scope, embeds });
    // Remember the most-recent listing so a bulk "/done all" can fan out over it (classic thread.lastListing).
    if (Array.isArray(reply?.payload?.items)) _lastKringListing = { appOrigin: entry?.appOrigin, items: reply.payload.items };
    // Classic parity (P6.6/P6.7): after a /find reply, enrich with in-circle skill matches + an optional hop
    // prompt. Best-effort — never let it break the dispatch.
    try { await appendFindExtras(reply); } catch { /* enrichment is non-essential */ }
  }

  // After /find returns, append (1) in-circle SKILL MATCHES for the query, and (2) a HOP PROMPT when the
  // search came up short but the user has hop-eligible contacts + hop is on. Ported from classic main.js
  // (appendFindExtras); the building blocks (findSkillMatches / hopPrompt) are shared.
  async function appendFindExtras(reply) {
    const { skillMatches, hopCard } = await buildFindExtras({
      query: reply?.payload?.query, groups: reply?.payload?.groups,
      circleId: getActiveCircle(), callSkill: resolveCallSkill, t,
    });
    if (skillMatches.length) {
      const lines = skillMatches.map((m) => `• ${m.label} — ${m.skill}`).join('\n');
      _kringRender?.botBubble(`${t('circle.skillMatches.title')}\n${lines}`);
    }
    if (hopCard) _kringRender?.botBubble(`${hopCard.title}\n${hopCard.body}`);
  }

  // E2 — run a bulk route ("/done all") over the most-recent listing's items; item-changed events fan out
  // cross-thread via the event log. Ported from classic handleBulkRoute.
  async function handleBulkRoute(route) {
    const itemIds = (_lastKringListing?.items ?? []).map((it) => it.id).filter(Boolean);
    if (!itemIds.length) { _kringRender?.botBubble(t('circle.bulk.noList')); return; }
    try {
      const { message } = await executeBulkDispatch({
        bulk: route, itemIds, callSkill: rawCallSkill,
        emitEvent: (e) => { try { publishEventToLog(e); } catch { /* swallow */ } },
        opLabel: route.opId,
      });
      _kringRender?.botBubble(message);
    } catch (e) { _kringRender?.botBubble(t('circle.bot.failed', { msg: e?.message ?? String(e) })); }
  }
  circleDispatchReady = dispatchReady;   // expose so onSend can run a completed follow-up

  // S6.C (per-circle) — is the op's app turned on for the active circle? Reads the
  // circle's policy.features (the same store the settings + tab gate use).
  async function isOpAppEnabledForActiveCircle(appOrigin) {
    let policy = {};
    try { policy = (await policyStore.get(getActiveCircle())) ?? {}; } catch { /* default policy */ }
    return isAppSurfaceEnabled(appOrigin, policy, isFeatureEnabled);
  }

  // B · the default-deny capability decision for a user-initiated dispatch. Returns a deny code
  // ('app-disabled' | 'capability-denied') or null (allow). App enablement comes from the SAME source
  // the UI uses (isOpAppEnabledForActiveCircle → policy.features); the effective (verb × noun) set is
  // admin-template (policy.capabilities, Slice 2) ∩ member opt-outs (override.capabilityOptOuts, Slice 4).
  async function circleCapabilityDeny(appOrigin, opId, args) {
    const circleId = getActiveCircle();
    if (circleId == null) return null;                          // outside a circle → no per-circle gate
    const origin = appOrigin || catalog?.opsById?.get(opId)?.appOrigin;
    if (!origin) return null;                                   // unattributable → don't block here
    const op = catalog?.opsById?.get(opId)?.op;
    const enabled = await isOpAppEnabledForActiveCircle(origin);
    let policy = {}; let override = {};
    try { policy = (await policyStore.get(circleId)) ?? {}; } catch { /* default */ }
    try { override = (await overrideStore.get(circleId)) ?? {}; } catch { /* default */ }
    const eff = effectiveCapabilities(baseSources, {
      apps:         enabled ? [origin] : [],
      capabilities: policy.capabilities,          // Slice 2 — the admin freedom template
      optOuts:      override.capabilityOptOuts,   // Slice 4 — this member's declined caps
    });
    const r = checkCapability({ op, appOrigin: origin, args }, eff);
    return r.allow ? null : r.code;
  }

  // A tapped bubble button: S6.B screen button (has `screen`) → open the panel;
  // S6.A inline button (has `opId`) → dispatch its op against the item (resolve the
  // gate's `arg` / a picker param / else `id`).
  circleEmbedButtonTap = ({ opId, itemId, screen, action }) => {
    // General in-chat bot menus: a button may carry an `action` callback for a NON-circle bot, routed by
    // source. Feedback (fp:*) → its surface's tapButton; other in-chat bots plug in here.
    if (action) {
      if (action.startsWith('fp:')) { circleFeedbackMount?.surface?.tapButton?.(action, getActiveCircle()); return; }
      // Objective D — an ambiguous-slash choice: re-issue the chosen app-qualified command (with the
      // original body preserved) through the normal bot dispatch, which now parses to a unique app.
      if (action.startsWith('slash:')) { circleBot?.handle?.(action.slice('slash:'.length), {}); return; }
      // a disambiguation candidate → re-run the pending command with the chosen target bound.
      if (action.startsWith('clarify:')) { circleClarify?.pick?.(action.slice('clarify:'.length), _clarifyScope || {}); return; }
      // download a received peer file (bytes stashed when the file-share arrived).
      if (action.startsWith('file-dl:')) { const f = _fileShareInbox.get(action.slice('file-dl:'.length)); if (f) triggerBlobDownloadFromBase64(f.dataB64, f.name, f.mime); return; }
      return;
    }
    if (screen) { openCircleScreenPanel(screen); return; }
    if (!opId) return;
    const op = catalog?.opsById?.get(opId)?.op;
    const arg = op?.surfaces?.slash?.match?.arg
      ?? (op?.params || []).find((p) => p?.pickerSource)?.name
      ?? 'id';
    dispatchReady({ opId, args: itemId != null ? { [arg]: itemId } : {} });
  };

  circleClarify = createClarifyingDispatch({
    catalog: () => catalog,
    lookup,
    dispatchReady,
    // Interactive candidate buttons: tapping `clarify:<id>` re-runs pick() with the choice bound (the scope
    // is captured so the tap hits the right pending command).
    ask: ({ query, candidates }, scope) => {
      _clarifyScope = scope;
      _kringRender?.botBubble(
        t('circle.clarify.which', { query }),
        { buttons: (candidates || []).map((c) => ({ action: `clarify:${c.id}`, label: c.label })) });
    },
    askMissing: async ({ opId, param, query }) => {
      // A non-empty label that matched nothing → "couldn't find X". But a picker command given with NO
      // value (bare `/complete-task`) shouldn't say "couldn't find '' " — list the options to choose from.
      if (query && query.trim()) { _kringRender?.botBubble(t('circle.clarify.notFound', { query })); return; }
      const entry = catalog?.opsById?.get(opId);
      const listOp = (entry?.op?.params || []).find((p) => p.name === param)?.pickerSource?.listOp;
      let items = [];
      try { if (listOp) items = (await lookup(listOp, '', getActiveCircle(), entry?.appOrigin)) || []; } catch { /* keep empty */ }
      if (items.length) {
        // each option is an inline op-button: dispatch <opId> with the chosen id bound to the picker param.
        _kringRender?.botBubble(t('circle.clarify.whichMissing'),
          { buttons: items.map((c) => ({ opId, itemId: c.id, label: c.label })) });
      } else {
        _kringRender?.botBubble(t('circle.clarify.noneToPick'));
      }
    },
  });

  circleBot = createCircleDispatch({
    catalog: () => catalog,
    policy: policyFor,
    userDefault: () => userDefault,
    llmProviders,
    interpret: interpretToCommand,
    // Conversation memory — the recent kring turns, so follow-ups resolve against context.
    recentTurns: () => recentKringTurns({
      rows: buildKringStream({ events: eventLog.query({ excludeMuted: true }), circles: circlesCache, circleId: getActiveCircle() }),
      limit: 6,
    }),
    // A slash STRING → parse to {opId,args}; the LLM yields {opId,args}. Both flow through the
    // clarifying dispatch (unique → run; ambiguous → ask).
    dispatch: (input, ctx) => {
      let cmd = input;
      if (typeof input === 'string') {
        const parsed = catalog ? parseInput(input, catalog) : null;
        // Objective D — a colliding bare slash (`/done`) with no per-host override is AMBIGUOUS: offer the
        // app-qualified choices (`/tasks:done`, `/stoop:done`) instead of silently firing one app. The
        // qualified forms — and an overridden bare token — parse as normal `slash` and route below.
        if (parsed && parsed.kind === 'ambiguous') {
          const suffix = parsed.body ? ` ${parsed.body}` : '';
          _kringRender?.botBubble(
            t('circle.slash.ambiguous', { command: parsed.command }),
            { buttons: (parsed.choices || []).map((c) => ({
                action: `slash:${c.command}${suffix}`,
                label:  t('circle.slash.ambiguousChoice', { appId: c.appId, command: c.command }),
              })) });
          return undefined;
        }
        // Carry the command's declared owner (appOrigin) so a qualified form routes to the RIGHT app even
        // when the underlying op-id also collides (resolveDispatch reads the hint to pick the prefixed key).
        cmd = parsed && parsed.kind === 'slash' && parsed.opId
          ? { opId: parsed.opId, args: parsed.args || {}, appOrigin: parsed.appOrigin }
          : null;
      }
      if (!cmd || !cmd.opId) { _kringRender?.botBubble(t('circle.bot.unknown')); return undefined; }
      // E2 bulk fan-out ("/done all"): resolveDispatch flags it (the body is a bulk keyword on a mutation op).
      // Run it over the last listing, bypassing the clarifying dispatch (which would treat "all" as a target).
      try {
        const r = resolveDispatch({ kind: 'slash', opId: cmd.opId, args: cmd.args || {}, appOrigin: cmd.appOrigin }, catalog);
        if (r && r.kind === 'bulk') return handleBulkRoute(r);
      } catch { /* not bulk → normal path */ }
      return circleClarify.run(cmd, ctx);
    },
    // A normal (non-command) message: fan out the ALREADY-appended optimistic bubble (onSend appended it
    // + passed its msgId in ctx) — same as mobile.
    postToKring: (text, ctx) => { if (ctx?.msgId) _kringRender?.fanOut(ctx.msgId, text, ctx.ts); },
    // Addressed the bot, but the LLM mapped it to no tool → reply instead of going silent.
    onNoMatch: (_text, _ctx, opts) => { _kringRender?.botBubble((opts && opts.reply) || t('circle.bot.unknown')); },
    // Smart chat off / unreachable → plain-language "basic mode" reply (contextual indicator, no badge).
    onLlmUnavailable: () => { _kringRender?.botBubble(t('circle.bot.basic_mode')); },
    // F-retrieve: on the via:'llm' path the gate pulls the circle's relevant items
    // into the LLM prompt (grounding + fewer tokens). `makeCircleRetriever` is now
    // backed by a PERSISTENT `@canopy/pod-search` hybrid index — the circle's items
    // are indexed once (embed-once via the content-hash cache; restart-safe when a
    // vectorStore is wired) and each turn runs a HYBRID (lexical+semantic RRF)
    // query. `embedder` rides the circle's embed policy (`resolveCircleRagEmbedder`,
    // same resolution as folio /zoek); null when off/unconfigured → LEXICAL-only,
    // NO embed call. Ranking lives once in circleRetriever; `loadItems` is the
    // shell adapter.
    gate: createTokenGate({
      rules: circleGateRules(currentLang()),
      retrieve: makeCircleRetriever({
        embedder: CIRCLE_EMBED_BASEURL ? resolveCircleRagEmbedder : undefined,
        loadItems: (ctx) => loadCircleItems({
          callSkill: resolveCallSkill,
          circleId: ctx?.circleId ?? getActiveCircle(),
        }),
        // Semantic cosine floor: weak/near-noise hybrid matches are dropped
        // before they reach the LLM prompt. Threaded explicitly from the shared
        // default (also applied by construction inside makeCircleRetriever, so
        // web ≡ mobile); raise it here to be stricter, pass 0 to disable.
        minScore: DEFAULT_CIRCLE_RAG_MIN_SCORE,
        // Persistence seam (vectorStore): threaded end-to-end into PodSearch
        // (makeCircleRetriever → makePodSearchRetriever → new PodSearch), which
        // persists vectors under private/state/search-index/circle-rag/<id>/
        // (NEVER sharing/ — invariant #7). We wire the circle's available
        // StorageBackend — the SAME @canopy/pseudo-pod substrate the circle pod
        // runs on — so the seam is LIVE end-to-end: a fresh PodSearch over this
        // store hydrates the content-hash cache instead of re-embedding
        // (embed-once, restart-safe by construction when the backend persists).
        //
        // Objective L (2026-07-08): the backend now PERSISTS in a real browser —
        // circleSearchVectorStore is IndexedDB (pickWebBackend), and the circle
        // ITEMS it indexes are IndexedDB too (makeCirclePodClient → pickWebBackend),
        // so both survive a hard reload; under SSR / tests (no `indexedDB`) both
        // fall back to in-memory, unchanged. The remaining persistence path — a
        // real signed-in Solid pod (live-infra routing) — stays the live-pod tail.
        vectorStore: circleSearchVectorStore,
        scope: 'circle-rag',
      }),
    }),
    botName: CIRCLE_BOT_NAME,
  });
}

// Top-level tab bar (Kringen / Stroom / Mij). Shown on the three top-level
// surfaces; hidden inside a circle + its sub-screens.
function showTabBar(active) {
  renderCircleTabBar(tabBarEl, {
    active, t,
    onScreens: showScreens,
    onKringen: showLauncher,
    onContacts: showContacts,
    onMij: showMij,
  });
}

// P5 — Contacten tab: the bot/peer roster.  Reads the app PeerGraph via the
// shared `listContacts`; tapping a row opens its 1:1 DM thread; "+ Add a bot"
// discovers/adds a bot into the graph.
async function showContacts() {
  showTabBar('contacten');
  let contacts = [];
  try { contacts = await loadAllContacts(); } catch { contacts = []; }
  // cluster J — added feedback bots (from an invite link/QR) show as agent contacts at the top.
  let fbBots = [];
  try { fbBots = await feedbackBotStore.list(); } catch { fbBots = []; }
  if (fbBots.length) contacts = [...fbBots, ...contacts.filter((c) => !fbBots.some((f) => f.contactId === c.contactId))];
  renderContactsRoster(rootEl, {
    contacts, t,
    onOpen: showContactThread,
    onAdd: () => {
      const input = (globalThis.prompt?.(t('circle.contacts.add_prompt')) || '').trim();
      if (input) addBotFromInput(input);
    },
  });
}

// S1 #2 — the unified Contacten roster: PeerGraph bots/peers MERGED with the
// stoop ContactBook (people the user added, with trust/tags). One directory.
async function loadStoopContacts() {
  try {
    const res = await rawCallSkill('stoop', 'listContacts', {});
    return (Array.isArray(res?.contacts) ? res.contacts : []).map(stoopContactToRow).filter(Boolean);
  } catch { return []; }
}
async function loadAllContacts() {
  const [peerRows, stoopRows] = await Promise.all([
    listContacts(circlePeerGraph).catch(() => []),
    loadStoopContacts(),
  ]);
  return mergeContacts(peerRows, stoopRows);
}

/**
 * objective L · Phase 2 — open the OUT-OF-CIRCLE recipient picker overlay. Lists the Contacten roster's
 * pickable recipients (the SHARED `pickableRecipients` selector, applied inside `renderRecipientPicker`);
 * selecting one dispatches `shareItemToContact` with the contact's published key as `recipientNetworkKey`,
 * ALONGSIDE the existing share-to-circle path (`/shareitem` → shareItemIntoCircle). A self-contained modal
 * appended to the body so it doesn't disturb the kring render state. Resolves the result note back to the caller.
 */
async function openRecipientPicker({ itemId, fromCircleId, toCircleId, onResult } = {}) {
  const contacts = await loadAllContacts().catch(() => []);
  // Self-contained centered modal (inline styles, like the catch-up overlay) so it needs no CSS file.
  const backdrop = document.createElement('div');
  backdrop.className = 'cc-recipient-overlay';
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:1002', 'display:flex',
    'align-items:center', 'justify-content:center', 'background:rgba(0,0,0,0.4)',
  ].join(';');
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'background:#fff', 'border-radius:12px', 'padding:16px', 'max-width:min(92vw,420px)',
    'max-height:80vh', 'overflow:auto', 'box-shadow:0 6px 24px rgba(0,0,0,0.25)',
    'font-family:system-ui,sans-serif',
  ].join(';');
  backdrop.appendChild(overlay);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });   // click-outside closes
  renderRecipientPicker(overlay, {
    contacts, itemId, t,
    onCancel: close,
    onPick: async (r) => {
      const res = await shareItemToContact({
        itemId, fromCircleId, toCircleId,
        recipient: r.id, recipientNetworkKey: r.recipientNetworkKey,
      }).catch((cause) => ({ ok: false, error: cause?.message ?? 'unknown' }));
      close();
      onResult?.(res, r);
    },
  });
}

// P5 — add a bot to the app PeerGraph (an https agent-card URL → discoverA2A;
// else a raw peer address → manual upsert), then re-render the roster.  Reuses
// the shared `addBotToGraph` (web≡mobile).  Best-effort: a bad URL/address shows
// a localised alert, never throws into the UI.
async function addBotFromInput(input) {
  // cluster J — a feedback INVITE link/QR adds the co-hosted feedback bot (NOT a PeerGraph peer).
  const fb = feedbackBotFromInput(input, { activationUrl: FEEDBACK_ACTIVATION_URL || undefined });
  if (fb) {
    await feedbackBotStore.add(fb);
    globalThis.alert?.(t('circle.contacts.added', { name: fb.name }));
    showContacts();
    return;
  }
  if (!circlePeerGraph) return;
  try {
    const rec = await addBotToGraph({ input, peerGraph: circlePeerGraph, coreAgent: circleCoreAgent, discover: discoverA2A });
    globalThis.alert?.(t('circle.contacts.added', { name: rec?.name ?? rec?.url ?? rec?.pubKey ?? '' }));
  } catch (err) {
    console.warn('[circleApp] add bot failed:', err?.message ?? err);
    globalThis.alert?.(t('circle.contacts.add_failed'));
  }
  showContacts();
}

// P5 — a 1:1 DM thread with a contact-bot.  The conversational turn goes over
// the contact-thread channel (sa.peer → mdns/relay/nkn); the async reply lands
// via `onContactReply` (registered in the peer router) and re-renders here.
async function showContactThread(contactId) {
  // cluster J — an added feedback bot opens its OWN dedicated thread (co-hosted, real-pod activation).
  if (String(contactId).startsWith('fp-bot:')) {
    const bot = await feedbackBotStore.get(contactId);
    if (bot) { await showFeedbackThread(bot); return; }
  }
  hideCircleTabBar(tabBarEl);
  let row = null;
  try { row = (await loadAllContacts()).find((c) => c.contactId === contactId) ?? null; }
  catch { /* fall back to any cached thread below */ }
  const name = row?.name ?? contactThreads.get(contactId)?.name ?? contactId;
  const peerAddr = row?.peerAddr ?? contactThreads.get(contactId)?.peerAddr ?? contactId;
  if (!contactThreads.has(contactId)) contactThreads.set(contactId, { name, peerAddr, messages: [] });
  const thread = contactThreads.get(contactId);
  thread.name = name; thread.peerAddr = peerAddr;

  // #13 — the bot's P4 skills, shown as in-thread quick actions. Tapping one (or
  // typing `/<skill> args`) DISPATCHES it to the bot via the P4 registry
  // (sendA2ATask), distinct from a free-text conversational turn over the channel.
  const skills = circleContactSkills?.skillsFor?.(contactId) ?? [];

  let busy = false; let error = false;

  // Dispatch a named skill to this bot and append its reply.
  async function runSkill(skillId, args = {}) {
    error = false;
    thread.messages.push({ origin: 'user', text: `/${skillId}` });
    busy = true; rerender();
    try {
      const res = await circleContactSkills.callSkill(contactId, skillId, args);
      const text = replyTextFromResult(res);
      if (text) thread.messages.push({ origin: 'bot', text });
    } catch {
      error = true;
    } finally {
      busy = false; rerender();
    }
  }

  const rerender = () => renderContactThread(rootEl, {
    name, messages: thread.messages, skills, busy, error, t,
    onBack: showContacts,
    onSkillTap: (sk) => runSkill(sk.id),
    onSend: async (text) => {
      // `/skill args` → dispatch as a skill; otherwise a conversational turn.
      if (text.startsWith('/')) {
        const sp = text.slice(1).indexOf(' ');
        const skillId = sp === -1 ? text.slice(1) : text.slice(1, sp + 1);
        const rest = sp === -1 ? '' : text.slice(sp + 2).trim();
        if (skills.some((s) => s.id === skillId)) { await runSkill(skillId, rest ? { text: rest } : {}); return; }
      }
      error = false;
      thread.messages.push({ origin: 'user', text });
      busy = true; rerender();
      try {
        const { sent } = circleContactChannel.sendTurn({
          peerAddr: thread.peerAddr, threadId: contactId, text,
        });
        await sent;
      } catch {
        error = true;
      } finally {
        busy = false; rerender();
      }
    },
  });
  _activeContactThread = { contactId, rerender };
  rerender();
}

// cluster J — the dedicated feedback bot thread. The added fp-bot contact opens here; the feedback surface
// renders text + buttons (consent · the verify bubble). On first open we build the verify pods
// (own/central/control) via buildFeedbackVerifyPods, and surface.start polls the lead's /control/ round →
// the verify bubble. Reuses renderContactThread (buttons + onButtonTap) like a peer DM, but co-hosted.
function _renderFbThread(botId) {
  const ft = _fbThreads.get(botId);
  if (!ft || _activeFbThread?.botId !== botId) return;
  renderContactThread(rootEl, {
    name: ft.name, messages: ft.messages, skills: [], busy: !!ft.busy, error: false,
    t: (k, p) => t(k, p, ft.botLang),                  // chrome renders in the BOT's chosen language
    langValue: ft.botLang,
    onLangChange: (lg) => _changeFbLang(botId, lg),
    inputValue: ft.pendingEditText || '',
    inputHint: ft.editingId ? t('circle.feedback.edit_hint', { defaultValue: 'Pas de tekst aan en verstuur' }, ft.botLang) : '',
    onBack: () => { ft.editingId = null; _activeFbThread = null; showContacts(); },
    // the bot's AI clean/summarise takes a few seconds per message — show a "thinking" state so /klaar
    // doesn't look frozen.
    onButtonTap: async (b) => {
      const id = b.action ?? b.callbackData ?? b.id;
      // inline edit: ✏ a point → pre-fill the composer with its current curated text (no bot round-trip).
      const m = /^fp:edit:(p\d+)$/.exec(id || '');
      const p = m && Array.isArray(ft.reviewPoints) ? ft.reviewPoints.find((x) => x.id === m[1]) : null;
      if (p) { ft.editingId = p.id; ft.pendingEditText = p.text; _renderFbThread(botId); return; }
      ft.busy = true; _renderFbThread(botId);
      try { await ft.surface?.tapButton?.(id, botId); } finally { ft.busy = false; _renderFbThread(botId); }
    },
    onSend: async (text) => {
      const editId = ft.editingId; ft.editingId = null;          // editing → rewrite that point in place
      const toSend = editId ? `fp:edit:${editId}:${text}` : text;
      ft.busy = true; _renderFbThread(botId);
      try { await ft.surface?.handle?.(toSend, botId); } finally { ft.busy = false; _renderFbThread(botId); }
    },
  });
  ft.pendingEditText = '';   // one-shot pre-fill (renderer rebuilds the input each render)
}
function _buildFbSurface(botId, pods) {
  const ft = _fbThreads.get(botId);
  ft.surface = createFeedbackSurface({
    projectId: String(botId).replace(/^fp-bot:/, ''),   // bind the dispatcher to the activation project (verify-round match)
    lang: ft.botLang,                                    // the participant's chosen bot language (text + cards + pipeline)
    llmBaseURL: FEEDBACK_LLM_BASEURL,
    llmModel: FEEDBACK_LLM_MODEL,
    pod: pods?.ownPod, centralPod: pods?.centralPod, controlStore: pods?.controlStore,
    emit: ({ text, buttons, kind, points, labels }) => {
      if (kind === 'review' && Array.isArray(points)) {
        ft.reviewPoints = points;   // for the ✏ composer pre-fill
        ft.messages.push({ origin: 'bot', kind: 'review', intro: text, points, labels });   // → editable per-point cards (labels in the bot's language)
      } else {
        ft.messages.push({ origin: 'bot', text, buttons: (buttons || []).map((b) => ({ id: b.id, action: b.id, label: b.label })) });
      }
      _renderFbThread(botId);
    },
  });
  ft.mount = createFeedbackMount({
    surface: ft.surface,
    appendUserBubble: (_t, x) => { ft.messages.push({ origin: 'user', text: x }); _renderFbThread(botId); },
    appendBotBubble:  (_t, x) => { ft.messages.push({ origin: 'bot', text: x }); _renderFbThread(botId); },
  });
}
// The participant switches the bot's language: rebuild the bot in that language (reusing the activated pods —
// no re-activation) and re-start the thread, so text + cards + chrome all localise. Persisted per-bot.
async function _changeFbLang(botId, lg) {
  const ft = _fbThreads.get(botId);
  if (!ft || (lg !== 'nl' && lg !== 'en') || lg === ft.botLang) return;
  ft.botLang = lg;
  try { localStorage.setItem(`fp.lang.${botId}`, lg); } catch { /* best-effort */ }
  ft.messages = []; ft.reviewPoints = null; ft.editingId = null;
  _buildFbSurface(botId, ft.pods || null);
  ft.busy = true; _renderFbThread(botId);
  try { await ft.surface.start(botId); }
  catch (e) { ft.messages.push({ origin: 'bot', text: `⚠ ${e?.message ?? e}` }); }
  finally { ft.busy = false; _renderFbThread(botId); }
}
async function showFeedbackThread(bot) {
  hideCircleTabBar(tabBarEl);
  const botId = bot.id;
  if (!_fbThreads.has(botId)) {
    let stored = null; try { stored = localStorage.getItem(`fp.lang.${botId}`); } catch { /* no storage */ }
    const botLang = (stored === 'nl' || stored === 'en') ? stored : detectDeviceLang();
    _fbThreads.set(botId, { name: bot.name, messages: [], surface: null, mount: null, activated: false, botLang, pods: null });
  }
  const ft = _fbThreads.get(botId);
  _activeFbThread = { botId };
  if (!ft.surface) _buildFbSurface(botId, null);
  _renderFbThread(botId);
  if (!ft.activated) {
    ft.activated = true;
    const activationUrl = bot.activationUrl || FEEDBACK_ACTIVATION_URL;
    try {
      const session = podAuth.getCurrentSession?.();
      if (session?.webid && activationUrl) {
        const pods = await buildFeedbackVerifyPods({ session, activationUrl, projectId: bot.projectId, code: bot.code, recoveryHash: await getOrCreateRecoveryHash(), podRef: bot.podRef });
        if (pods.podRef && pods.podRef !== bot.podRef) { try { await feedbackBotStore.add({ ...bot, podRef: pods.podRef }); } catch { /* persist best-effort */ } }
        ft.pods = pods;                 // cache for a language switch (rebuild the bot without re-activating)
        _buildFbSurface(botId, pods);   // rebuild the surface WITH the real own/central/control pods
      } else if (!session?.webid) {
        ft.messages.push({ origin: 'bot', text: t('circle.feedback.login_first', { defaultValue: 'Log eerst in op je pod om mee te doen.' }) });
        _renderFbThread(botId);
      }
    } catch (e) {
      ft.activated = false;   // allow a retry on reopen
      const detail = e?.message ?? String(e);
      console.error('[circleApp] feedback activation failed:', e);
      ft.messages.push({ origin: 'bot', text: t('circle.feedback.activation_failed', { error: detail, defaultValue: `Activatie mislukt: ${detail}` }) });
      _renderFbThread(botId);
    }
  }
  // start() polls the lead's /control/ round + summarises on-device (an AI call, a few seconds) — show a
  // busy state so the open doesn't look frozen, and surface any error in the chat (not just the console).
  ft.busy = true; _renderFbThread(botId);
  try { await ft.surface.start(botId); }
  catch (e) { console.error('[circleApp] feedback poll/start failed:', e); ft.messages.push({ origin: 'bot', text: `⚠ ${e?.message ?? e}` }); }
  finally { ft.busy = false; _renderFbThread(botId); }
}

// #13 — pull human-readable text out of a remote-skill result (the channel's
// sendTask resolves to the A2A Task's `{ parts }`; a part is `{ text }` or a
// string). Falls back to a JSON string so nothing is silently dropped.
function replyTextFromResult(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (typeof res.text === 'string') return res.text;
  const parts = Array.isArray(res.parts) ? res.parts : null;
  if (parts) {
    const text = parts.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).filter(Boolean).join('\n');
    if (text) return text;
  }
  try { return JSON.stringify(res); } catch { return ''; }
}

// P5/S1 #3 — inbound handler for a bot reply (contact-reply) AND a peer DM
// (contact-msg). Routes by threadId when echoed, else by the sender address (==
// the contactId for a native peer); appends the other party's bubble and
// re-renders if that thread is on screen. For a brand-new thread (someone DMs you
// first), resolves their display name from the merged directory, best-effort.
function onContactReply({ fromAddr, threadId, text, buttons }) {
  const contactId = (threadId && contactThreads.has(threadId)) ? threadId : fromAddr;
  let thread = contactThreads.get(contactId);
  const isNew = !thread;
  if (isNew) { thread = { name: contactId, peerAddr: fromAddr, messages: [] }; contactThreads.set(contactId, thread); }
  thread.messages.push({ origin: 'bot', text, buttons });
  if (_activeContactThread?.contactId === contactId) _activeContactThread.rerender();
  // Resolve a friendlier name for an unsolicited inbound thread (fire-and-forget).
  if (isNew) {
    loadAllContacts()
      .then((rows) => {
        const row = rows.find((c) => c.contactId === contactId);
        if (row?.name && row.name !== contactId) {
          thread.name = row.name;
          if (_activeContactThread?.contactId === contactId) _activeContactThread.rerender();
        }
      })
      .catch(() => {});
  }
}

// P6.3 — seenAt persistence: bumped on showDetail(id) so unread counts
// reset after the user opens a circle.  One key holds {circleId → ts}.
const SEEN_AT_KEY = 'cc.circleSeenAt';
function readSeenAt() {
  try { const raw = window.localStorage.getItem(SEEN_AT_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function writeSeenAt(map) {
  try { window.localStorage.setItem(SEEN_AT_KEY, JSON.stringify(map)); }
  catch { /* quota / disabled */ }
}

// SP-13.4 — Chat ↔ Scherm pill: per-circle preference persists in
// localStorage so the user lands back in whichever mode they last used
// for that kring.
//
// §4 — when the member has NO saved override for this kring yet, the
// landing surface is the admin's `policy.view` front door
// (defaultViewModeFromPolicy): 'screen' → scherm, 'chat'/'cross-stream'
// → chat.  Once the user flips the pill, their choice persists and wins.
const VIEW_MODE_KEY = 'cc.circleViewMode';
function readViewMode(id, policy = null) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const saved = map?.[id];
    if (saved === 'scherm' || saved === 'chat') return saved;
    return defaultViewModeFromPolicy(policy);
  } catch { return defaultViewModeFromPolicy(policy); }
}
function writeViewMode(id, mode) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[id] = mode;
    window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(map));
  } catch { /* quota / disabled */ }
}

// β.5 — pinned + muted maps cached at the launcher level so the host
// can re-render without an async round-trip when the user toggles a
// pin/mute from the per-tile menu.  Refreshed in `refreshLauncherPins`
// and `refreshLauncherMutes` (both fire-and-forget on launcher entry).
let launcherPinnedMap = {};
let launcherMutedMap  = {};

async function refreshLauncherPins() {
  try { launcherPinnedMap = await pinStore.get(); }
  catch { launcherPinnedMap = {}; }
}
async function refreshLauncherMutes() {
  const next = {};
  for (const c of circlesCache) {
    try {
      const o = await overrideStore.get(c.id);
      if (o?.chatOff) next[c.id] = true;
    } catch { /* skip */ }
  }
  launcherMutedMap = next;
}

// β.5 — paint the launcher tiles (previews + pin/mute/proposal state). PURE render, no async
// re-scheduling — so it's safe to call from the pins/mutes refresh `.then` WITHOUT re-entering
// showLauncher (which would re-schedule that refresh and loop forever; that infinite re-render
// starved the main thread and hung the headless e2e, 2026-06-11).
function paintLauncher() {
  // P6.3 — project the EventLog into per-circle previews; tiles show a
  // chat-style subtitle + unread badge when there's recent activity.
  const previews = buildTilePreviews({
    events:  eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
    seenAt:  readSeenAt(),
  });
  // β.5 — per-tile context menu handlers (pin / mute / settings / leave).
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    previews,
    proposals: launcherProposals,
    pinnedMap: launcherPinnedMap,
    mutedMap:  launcherMutedMap,
    t,
    onOpenCircle: showDetail,
    onNewCircle:  createCircle,
    onJoinCircle: showJoinCircle,
    onPin:        onPinCircle,
    onMute:       onMuteCircle,
    onSettings:   (id) => showSettings(id),
    onLeave:      onLeaveCircle,
  });
}

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  // β.1 — Stream/Availability/Hop/Nearby/My-things buttons are gone from the launcher; those surfaces
  // are reachable via the Schermen + Mij tabs. The `show*` functions stay defined below.
  paintLauncher();
  showTabBar('kringen');
  // Refresh proposal counts in the background so the next launcher render shows yellow badges where
  // consensus is waiting. Async so the first paint isn't blocked.
  refreshLauncherProposals().catch(() => { /* ignore */ });
  // β.5 — pull fresh pin + mute state, then RE-PAINT (not re-enter showLauncher — see paintLauncher)
  // so a just-toggled state shows immediately, without looping.
  Promise.all([refreshLauncherPins(), refreshLauncherMutes()])
    .then(() => { if (getActiveCircle() == null) paintLauncher(); })
    .catch(() => { /* tolerate */ });
}

// β.5 — toggle pin state + refresh the launcher so the tile reflows
// (pins float to the top of their section).
async function onPinCircle(id) {
  try { launcherPinnedMap = await pinStore.toggle(id); }
  catch { /* keep cache; stale UI is fine */ }
  if (getActiveCircle() == null) showLauncher();
}

// β.5 — toggle the per-kring chatOff override (the mute field already
// exists in DEFAULT_MEMBER_OVERRIDE / mergeMemberOverride).  No new
// substrate added; mute is *exposed* here, not invented.
async function onMuteCircle(id) {
  try {
    const cur = await overrideStore.get(id);
    await overrideStore.update(id, { chatOff: !cur.chatOff });
  } catch { /* tolerate */ }
  await refreshLauncherMutes();
  if (getActiveCircle() == null) showLauncher();
}

// β.5 — Leave kring: confirm, then dispatch `/leave-group` via the
// raw callSkill seam (the stoop op `leaveGroup` already exists in the
// substrate; the slash-command name maps to that op in the chat shell).
async function onLeaveCircle(id, circle) {
  const name = circle?.name ?? id;
  const ok = (typeof globalThis.confirm === 'function')
    ? globalThis.confirm(t('circle.tile.menu.leave_confirm', { name }))
    : true;
  if (!ok) return;
  const dispatch = resolveCallSkill ?? rawCallSkill;
  if (typeof dispatch === 'function') {
    try {
      // The stoop substrate exposes `leaveGroup`; the slash router
      // resolves /leave-group to this op.  Calling the resolved op
      // directly here keeps β.5 standalone (no chat-shell dependency).
      await dispatch('leaveGroup', { groupId: id });
    } catch (err) {
      console.warn('[circleApp] leaveGroup failed:', err?.message ?? err);
    }
  }
  try { circlesCache = await loadCircles(sources); }
  catch { /* keep cache */ }
  // Drop the pin if the circle is gone — the map otherwise keeps a
  // dangling key that the partition would happily filter out anyway,
  // but cleanup keeps storage tidy.
  try {
    const cur = await pinStore.get();
    if (cur[id]) { await pinStore.toggle(id); launcherPinnedMap = await pinStore.get(); }
  } catch { /* tolerate */ }
  if (getActiveCircle() == null) showLauncher();
}

// P6.2 #341 + P6.10 #348 — per-circle pending-admin-action counts.  The
// launcher's voorstellen badge surfaces the SUM of pending proposals
// (multi-admin consensus) + pending agent-add requests (board 4B):
// both shapes wait for the same admins, so collapsing them into one
// "needs your attention" badge keeps the launcher legible.
let launcherProposals = {};
async function refreshLauncherProposals() {
  const next = {};
  for (const c of circlesCache) {
    let n = 0;
    try { n += await proposalStore.countPending(c.id); } catch { /* ignore */ }
    try { n += await agentRequestStore.countPending(c.id); } catch { /* ignore */ }
    if (n > 0) next[c.id] = n;
  }
  const sameKeys = Object.keys(next).length === Object.keys(launcherProposals).length
    && Object.keys(next).every((k) => next[k] === launcherProposals[k]);
  launcherProposals = next;
  if (!sameKeys && getActiveCircle() == null) showLauncher();
}

// P6.8 #346 — Nearby screen on web.  mDNS isn't live in the browser
// (substrate path is mobile-only today), so peers stay [] and the
// screen renders an honest empty state + the user's own published
// skills footer so they can see what others would see.
function showNearby() {
  hideCircleTabBar(tabBarEl);
  const model = buildNearbyModel({ peers: [], mySkills: [], t });
  renderCircleNearby(rootEl, { model, t, onBack: showLauncher });
}

// P6.M7 #349 — Mijn dingen notes-list (private kring, board 10A).  Files
// come from the Folio listFiles op filtered for mine + circle-less.  The
// active user webid stays null on web today; the substrate falls back to
// "anything without an owner" which matches the V0 single-user state.
async function showMyThings() {
  hideCircleTabBar(tabBarEl);
  let files = [];
  const rerender = () => renderCircleMyThings(rootEl, {
    files, t, onBack: showLauncher,
  });
  rerender();
  if (resolveCallSkill) {
    try {
      const res = await resolveCallSkill('listFiles', {});
      files = myThingsFromListFiles(res, null);
      rerender();
    } catch { /* keep empty */ }
  }
}

// Hopping is a DEVICE-global stance (Stoop getHopMode/setHopMode); it lives
// under the Mij tab (personal settings). Chain-card data lands later.
async function showHop() {
  hideCircleTabBar(tabBarEl);
  let hopMode = { global: false };
  if (resolveCallSkill) {
    try { hopMode = normalizeHopMode(await resolveCallSkill('getHopMode', {})); } catch { /* default */ }
  }
  const rerender = () => renderCircleHop(rootEl, {
    hopMode,
    t,
    onToggleGlobal: async (v) => {
      hopMode = { global: v };
      rerender();
      if (resolveCallSkill) {
        try {
          const r = await resolveCallSkill('setHopMode', { global: v });
          if (r && !r.error) { hopMode = normalizeHopMode(r); rerender(); }
        } catch { /* keep optimistic */ }
      }
    },
    onBack: showMij,
  });
  rerender();
}

// α.3 — Schermen tab.  Two sub-modes:
//   - 'picker' (default): list of the user's screens with CRUD affordances
//   - 'view':              render the materialized active screen as blocks
// First-run seed: when the book is empty, auto-create a "Stream" screen
// (kringFilter=null + noticeboard block) so the tab is useful right away.
//
// Q5 (mute) honoured: materializeScreen drops muted kringen entirely.
let _screenSubMode = 'picker';
let _viewingScreenId = null;
let _screensBook = null;
let _screenViewBlocks = null;
// δ.1 — monotonically-increasing token for each `_showActiveScreen` call.
// The async materialize compares its captured token against the latest
// before mutating the DOM, so a slow materialize from screen-A can't
// stomp the body once the user has navigated to screen-B (or back to
// the picker).
let _showActiveScreenToken = 0;

async function showScreens() {
  showTabBar('screens');
  let book;
  try { book = await userScreenStore.get(); }
  catch { book = { screens: [], activeId: null }; }
  // First-run seed: three default screens so the Schermen tab is
  // immediately useful — Stream (noticeboard across all kringen),
  // My things (tasks assigned to me, α.4), My calendar (agenda
  // events, α.4).  Once at least one screen exists we never
  // re-seed; the user can delete or rename any of them freely.
  if (book.screens.length === 0) {
    book = await userScreenStore.update((cur) => {
      let next = addUserScreen(cur, t('circle.screens.seed_name'));
      let id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'noticeboard'));
      next = addUserScreen(next, t('circle.screens.seed_my_things'));
      id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'tasks'));
      next = addUserScreen(next, t('circle.screens.seed_my_calendar'));
      id   = next.screens[next.screens.length - 1].id;
      next = updateScreen(next, id, (s) => addBlock(s, 'agenda'));
      return next;
    });
  }
  _screensBook = book;
  _screensRerender();
}

function _screensRerender() {
  if (_screenSubMode === 'view') {
    _showActiveScreen();
    return;
  }
  // Picker mode: list of screens with CRUD.
  renderScreensPicker(rootEl, {
    book: _screensBook,
    t,
    onOpenScreen:   (sid) => {
      _viewingScreenId = sid;
      _screenSubMode = 'view';
      _showActiveScreen();
    },
    onAddScreen: async (name) => {
      _screensBook = await userScreenStore.update((cur) => {
        const next = addUserScreen(cur, name);
        const newId = next.screens[next.screens.length - 1].id;
        // Seed every new screen with a default noticeboard block so
        // it's not empty on first open.
        return updateScreen(next, newId, (s) => addBlock(s, 'noticeboard'));
      });
      _screensRerender();
    },
    onRenameScreen: async (sid, name) => {
      _screensBook = await userScreenStore.update((cur) => renameUserScreen(cur, sid, name));
      _screensRerender();
    },
    onRemoveScreen: async (sid) => {
      _screensBook = await userScreenStore.update((cur) => removeUserScreen(cur, sid));
      _screensRerender();
    },
    onSetActive: async (sid) => {
      _screensBook = await userScreenStore.update((cur) => setActiveScreen(cur, sid));
      _screensRerender();
    },
  });
}

async function _showActiveScreen() {
  // View-mode: render the materialized screen + a back link to picker.
  const screen = _screensBook?.screens?.find((s) => s.id === _viewingScreenId)
              ?? getActiveScreen(_screensBook);
  if (!screen) {
    _screenSubMode = 'picker'; _viewingScreenId = null;
    _screensRerender();
    return;
  }
  rootEl.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-screens-view__back';
  back.textContent = `← ${t('circle.screens.picker_title')}`;
  back.addEventListener('click', () => {
    _screenSubMode = 'picker';
    _viewingScreenId = null;
    _screensRerender();
  });
  rootEl.appendChild(back);
  const title = document.createElement('h2');
  title.className = 'circle-screens-view__title';
  title.textContent = screen.name || t('circle.screens.untitled');
  rootEl.appendChild(title);

  // δ.1 — cache-first render: read the LAST materialized payload for this
  // screen and paint immediately so the press feels instant.  On a cache
  // miss we fall through to the existing Loading→fresh flow (null sentinel
  // → renderCircleScreen shows the loading hint).  Either way the fresh
  // materialize runs in the background; on result we swap in the result
  // and re-save the cache.  Race-token guards against a stale materialize
  // from a previously-open screen stomping the body once the user has
  // navigated away.
  const body = document.createElement('div');
  rootEl.appendChild(body);
  const token = ++_showActiveScreenToken;
  let cached = null;
  try { cached = await screenBlocksCache.get(screen.id); } catch { /* ignore */ }
  if (token !== _showActiveScreenToken || _viewingScreenId !== screen.id) return;
  if (Array.isArray(cached)) {
    _screenViewBlocks = cached;
    renderCircleScreen(body, { blocks: cached, t, refreshing: true });
  } else {
    renderCircleScreen(body, { blocks: null, t });
  }

  // Materialize blocks (with muted-kring filter when available later).
  let blocks = [];
  try {
    blocks = await materializeScreen({
      screen,
      hostOps: {
        callSkill: resolveCallSkill ?? rawCallSkill,
        eventLog, circles: circlesCache,
      },
      // mutedCircleIds wires in α.5 (per-user mute UI).
    });
  } catch (err) {
    console.warn('[showScreens] materializeScreen failed', err);
  }
  // Drop the result if the user navigated away (or to a different screen)
  // while materialize was in flight — otherwise the body could be
  // overwritten with stale content from a previously-open screen.
  if (token !== _showActiveScreenToken || _viewingScreenId !== screen.id) return;
  _screenViewBlocks = blocks;
  renderCircleScreen(body, { blocks, t, refreshing: false });
  // Save the fresh blocks back to the cache so the next open is also
  // instant.  Best-effort: a quota / serialization failure is silent.
  screenBlocksCache.set(screen.id, blocks).catch(() => { /* ignore */ });
}

function showStream() {
  const rows = buildCircleStream({
    events: eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
  });
  // Top-level tab screen — no back link (the Kringen tab is the way back).
  renderCircleStream(rootEl, { rows, t, onOpenCircle: showDetail });
  showTabBar('screens');   // α.3 — stroom retired in favour of screens
}

// "Mij" tab — personal availability (holiday + quiet hours, board 6C) plus
// the device-global Hopping stance.
// S2 — the Mij tab is now your PROFILE (handle + display name + personal skills +
// location), backed by stoop's profile ops. Availability/quiet-hours moves to a
// sub-screen reached from here.
async function showMij() {
  showTabBar('mij');
  let profile = {};
  let categories = [];
  let geocodeResult = null;
  let busy = false;

  async function load() {
    try {
      const [prof, cats] = await Promise.all([
        rawCallSkill('stoop', 'getMyProfile', {}).catch(() => null),
        rawCallSkill('stoop', 'listSkillCategories', { lang: currentLang() }).catch(() => null),
      ]);
      profile = prof?.entry ?? {};
      categories = Array.isArray(cats?.categories) ? cats.categories : [];
    } catch { /* keep defaults */ }
    rerender();
  }

  // D / SP-3b consumer-switch (second live surface) — the "Mij" profile header
  // is sourced from the manifest PAGE projection.  renderWeb(canopyChatManifest)
  // projects the `me` op's `surfaces.page` into pages[]; pageForOp selects it and
  // its labelKey → t() drives the header label (invariant #4 — the manifest is
  // the source of truth for surfaces; no more hardcoded tr('circle.profile.title')).
  const profilePage = pageForOp(canopyChatManifest, 'me');

  const rerender = () => renderCircleProfile(rootEl, {
    profile, categories, geocodeResult, busy, t,
    // D / SP-3b — the projected PAGE surface drives the header label (Q22 labelKey via t()).
    profilePage,
    onSaveProfile: async ({ handle, displayName }) => {
      busy = true; rerender();
      try {
        if (handle && handle !== profile.handle) await rawCallSkill('stoop', 'setMyHandle', { handle });
        if (displayName !== (profile.displayName ?? '')) await rawCallSkill('stoop', 'setMyDisplayName', { displayName });
      } catch { /* surfaced on reload */ }
      busy = false; await load();
    },
    onAddSkill: async (categoryId) => {
      try { await rawCallSkill('stoop', 'addMySkill', { categoryId }); } catch { /* */ }
      await load();
    },
    onRemoveSkill: async (categoryId) => {
      try { await rawCallSkill('stoop', 'removeMySkill', { categoryId }); } catch { /* */ }
      await load();
    },
    onGeocode: async (query) => {
      try { const r = await rawCallSkill('stoop', 'geocode', { query }); geocodeResult = r?.error ? null : r; }
      catch { geocodeResult = null; }
      rerender();
    },
    onSaveLocation: async () => {
      if (!geocodeResult) return;
      try { await rawCallSkill('stoop', 'setMyLocation', { cell: geocodeResult.cell, label: geocodeResult.label, source: 'geocode' }); } catch { /* */ }
      geocodeResult = null; await load();
    },
    onClearLocation: async () => {
      try { await rawCallSkill('stoop', 'clearMyLocation', {}); } catch { /* */ }
      await load();
    },
    onAvailability: showAvailability,
    onMyData: showMyData,
    // SILENT out-of-circle delivery — the personal, cross-circle "shared with me" inbox.
    onSharedWithMe: showSharedWithMe,
  });
  rerender();
  load();
}

// SILENT out-of-circle delivery — the "shared with me" inbox (a Mij sub-screen). Reads the
// per-user store (sealed copies peers pushed to this device over the relay) and renders the
// SHARED view projector; back returns to Mij. web ≡ mobile: both platforms surface the SAME
// view over the SAME `buildSharedWithMe`/`openSharedCopy` selector — this is just the web
// adapter (read the store, feed the projector).
//
// OPENING: a sealed copy is opened with THIS device's own network-derived sealing opener —
// `sealingKeyPairFromNetworkKey(myNetworkSecret)` → `makeOpener(privateKey)`, built via the
// shared `openerForIdentity` bridge over the chat agent's identity (`agent.sa.agent.identity`,
// the same one the peer address — hence the recipient network key — is derived from). The
// network secret stays ENCAPSULATED in the identity (only the opener closure escapes). When no
// identity is available the opener is null and `onOpen` stays DENY-SAFE (a row tap is a no-op,
// never ciphertext), exactly as the mobile SharedWithMeScreen degrades.
async function showSharedWithMe() {
  hideCircleTabBar(tabBarEl);
  let received = [];
  try { received = await sharedWithMeStore.list(); } catch { received = []; }
  // Project the raw store entries through the SHARED selector (newest-first, row shape) — the
  // SAME projection the mobile SharedWithMeScreen runs internally (web ≡ mobile).
  const entries = buildSharedWithMe(received);
  const opener = openerForIdentity(circleCoreAgent?.identity);   // network-derived; null → deny-safe no-op
  renderSharedWithMe(rootEl, {
    entries, t,
    onBack: showMij,
    onOpen: async (entry) => {
      if (typeof opener !== 'function') return;   // deny-safe: no opener → no-op (no leak)
      try { await openSharedCopy(entry, opener); } catch { /* wrong key / not a recipient — deny-safe */ }
    },
  });
}

// S5 — "My data": where your data lives (pod/relay) + privacy + usage + key
// management (back up · reveal recovery phrase · restore). A sub-screen of Mij.
async function showMyData() {
  hideCircleTabBar(tabBarEl);
  let dataLocation = {}; let podStatus = {}; let privacy = []; let metrics = {};
  // S4 — the actual pod sign-in state (reuses podAuth), + a sign-in button when local-only.
  const onSignIn = () => Promise.resolve(
    podAuth.startSignIn({ issuer: podAuth.DEFAULT_ISSUER_ID, redirectUrl: window.location.href }),
  ).catch((e) => globalThis.alert?.(e?.message ?? 'sign-in failed'));
  // S5 — launch the existing backup/restore wizards in a modal overlay; reveal
  // the recovery phrase via the stoop `getMnemonicOnce` skill (shown once).
  const onBackup = () => mountMyDataWizard(renderEncryptedBackupWizard);
  const onRestore = () => mountMyDataWizard(renderRestoreFromMnemonicWizard);
  const onViewMnemonic = () => showMnemonicReveal();
  // S5 — web-push toggle. State is read from the live PushManager so the screen
  // reflects reality; toggling subscribes/unsubscribes + tells stoop.
  let notifications = { supported: false, permission: 'default', subscribed: false };
  const onToggleNotifications = async () => {
    const res = notifications.subscribed
      ? await disableWebPush({ callSkill: rawCallSkill })
      : await enableWebPush({ callSkill: rawCallSkill });
    if (!res.ok && res.reason && res.reason !== 'denied') {
      globalThis.alert?.(t(`circle.mydata.notif_err_${res.reason.replace(/-/g, '_')}`, { defaultValue: res.reason }));
    }
    notifications = await getWebPushState();
    rerender();
  };
  // S6.C — surface preference (how the bot shows actions); set updates the store + repaints.
  const onSetSurfacePref = (v) => { circleSurfacePref.set(v).then(rerender).catch(() => {}); };
  // Global app language: persist the choice, switch, and re-render Mij now (other screens pick it up on next
  // open, since every show*() calls t() fresh).
  const onSetAppLang = async (lng) => {
    if (lng !== 'nl' && lng !== 'en') return;
    await setLang(lng);
    try { localStorage.setItem('circle.app.lang', lng); } catch { /* best-effort */ }
    showMij();
  };
  // S6.D — is the conversational "chat" projection AI-enriched in THIS circle?
  // (user-loaded LLM + circle policy.llmTool + a configured provider).
  let chatAi = { enriched: false, reason: 'no-provider' };
  let userLlmCfg = {};
  const userLlmStore = createUserLlmDefaultStore(localStorageUserLlmIo());
  (async () => {
    try {
      const pol = await policyStore.get(getActiveCircle());
      userLlmCfg = await userLlmStore.get();
      chatAi = resolveChatAi({
        circleLlmTool: pol?.llmTool ?? CIRCLE_LLM_POLICY,
        userLlmMode: userLlmCfg?.mode,
        hasProvider: !!CIRCLE_LLM_BASEURL || !!userLlmCfg?.llmBaseUrl,
      });
      rerender();
    } catch { /* keep the safe default */ }
  })();
  // Persist the member's assistant endpoint, then rebuild the LIVE providers (no reload). The guard runs
  // both here (inline message) and inside circleApplyUserLlm; returns an error string or null (success).
  const onSaveUserLlm = async (cfg) => {
    const guardErr = validateUserLlmConfig(cfg);
    if (guardErr) return guardErr;
    userLlmCfg = await userLlmStore.set(cfg).catch(() => cfg);
    const r = typeof circleApplyUserLlm === 'function' ? circleApplyUserLlm(userLlmCfg) : { ok: true };
    if (!r || !r.ok) return (r && r.error) || 'could not apply';
    // Providers are swapped live (no reload). Don't rerender the whole panel here — it would wipe the
    // form's "Saved." confirmation; the chatAi status note refreshes on the next open.
    return null;
  };
  // Objective D / Surface 4 (#180) — route the relay-URL editor through the generic
  // docked side-panel (openPagePanel's simple-form). The `set-relay` manifest op is
  // the FORM CONTRACT (params url · clear + surfaces.page); dispatch resolves to
  // applyRelayUrl — the circle shell's live in-app relay setting. (agent.callSkill
  // has no 'canopy-chat' builtin route in this shell, so the op binds to its real
  // handler right here, at the waist.) The panel builds + validates the form, shows
  // errors on {ok:false}, closes on success, and offers "← back to chat".
  const setRelayOp = canopyChatManifest.operations.find((o) => o.id === 'set-relay');
  const openRelayPanel = () => {
    if (!setRelayOp) return;
    let panel = document.getElementById('page-panel');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'page-panel';
      panel.className = 'cc-page-panel';
      panel.hidden = true;
      document.body.appendChild(panel);
    }
    // Localise the panel title via the op's labelKey without mutating the shared
    // manifest (openPagePanel's simple-form reads surfaces.page.title verbatim).
    const pg = setRelayOp.surfaces.page;
    const op = { ...setRelayOp, surfaces: { ...setRelayOp.surfaces, page: { ...pg, title: (pg.labelKey && t(pg.labelKey)) || pg.title } } };
    openPagePanel({
      container: panel, doc: document, op, appOrigin: 'canopy-chat',
      callSkill: async (_origin, _opId, args) => applyRelayUrl(args?.clear ? '' : String(args?.url ?? '')),
      onClose: () => {}, onDispatched: () => rerender(), t,
      backTo: { returnTo: getActiveCircle() || 'chat', label: t('circle.mydata.back'), onNavigate: () => {} },
    });
  };
  const rerender = () => renderCircleMyData(rootEl, { dataLocation, podStatus, privacy, metrics, t, onBack: showMij, onSignIn, onBackup, onViewMnemonic, onRestore, notifications, onToggleNotifications, surfacePref: circleSurfacePref.get(), onSetSurfacePref, appLang: currentLang(), onSetAppLang, chatAi, userLlm: userLlmCfg, onSaveUserLlm, validateUserLlm: validateUserLlmConfig,
    // in-app relay setting (no rebuild): the field shows the saved setting; env is the placeholder fallback.
    // Objective D / Surface 4: onOpenRelayPanel routes editing into the docked side-panel (openPagePanel).
    relayUrl: resolveRelayUrl(localStorageRelayIo().load(), ''), relayEnvUrl: CIRCLE_RELAY_ENV, onSaveRelay: applyRelayUrl, onOpenRelayPanel: openRelayPanel });
  getWebPushState().then((s) => { notifications = s; rerender(); }).catch(() => {});
  rerender();
  const [loc, status, priv, met] = await Promise.all([
    rawCallSkill('stoop', 'getDataLocation', {}).catch(() => null),
    rawCallSkill('stoop', 'podSignInStatus', {}).catch(() => null),
    rawCallSkill('stoop', 'getPrivacyNotice', { lang: currentLang() }).catch(() => null),
    rawCallSkill('stoop', 'getMetrics', {}).catch(() => null),
  ]);
  dataLocation = loc ?? {};
  podStatus = status ?? {};
  // Prefer the real Solid session over the (aspirational) stoop op.
  const sess = podAuth.getCurrentSession?.();
  if (sess?.isLoggedIn && sess.webid) {
    podStatus = { signedIn: true, webid: sess.webid };
    if (circleRealPodRouting?.podRoot) dataLocation = { ...dataLocation, podRoot: circleRealPodRouting.podRoot };
  }
  privacy = Array.isArray(priv?.sections) ? priv.sections : [];
  metrics = (met?.snapshot && typeof met.snapshot === 'object') ? met.snapshot : {};
  rerender();
}

// S5 — mount one of the existing wizard renderers (encrypted-backup / restore)
// inside a dismissable modal overlay. The wizard owns its own DOM; we supply the
// container + the shared `rawCallSkill` (the wizards call `callSkill('stoop', …)`).
function mountMyDataWizard(renderWizard, extra = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'cc-mydata-modal';
  const card = document.createElement('div');
  card.className = 'cc-mydata-modal__card';
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  function close() { try { overlay.remove(); } catch { /* defensive */ } }
  try {
    // Thin adapter: hand the shared renderer this shell's DOM + rawCallSkill; `extra` lets a wizard that
    // needs more (the join wizard wants `args`/`sendPeerRedeem`) get it without a bespoke mount fn.
    renderWizard({ container: card, doc: document, callSkill: rawCallSkill, onClose: close, onDispatched: () => {}, ...extra });
  } catch (err) { close(); globalThis.alert?.(err?.message ?? String(err)); }
}

// OBJ-2 — Join a circle (no pod). Paste an invite (the QR's stoop-invite:// payload) and mount the SHARED
// join wizard through the same overlay adapter; the joiner-side peer-redeem sender carries the no-pod
// handshake. On success we feed the new roster (so items sync) and refresh the launcher. Pure reuse.
function showJoinCircle() {
  const invite = (globalThis.prompt?.(t('circle.join.paste')) || '').trim();
  if (!invite) return;
  mountMyDataWizard(renderJoinGroupWizard, {
    args: { invite },
    sendPeerRedeem: circleSendPeerRedeem,
    // B · Slice 4 — the merged manifest sources let the wizard build the join-time capability consent
    // model from the invite's embedded freedom template.
    sources: circleBaseSources,
    onDispatched: async (reply) => {
      const gid = reply?.groupId ?? reply?.joinedGroupId ?? null;
      if (gid) { try { await feedHouseholdRosterForCircle?.(gid); } catch { /* best-effort */ } }
      // B · Slice 4 — record the joiner's capability opt-outs into their prefs for this circle, so the
      // gate's effective set (admin-template ∩ user-opt-outs) drops the declined caps from the first
      // dispatch. Opt-out-nothing ⇒ no write (unchanged behaviour).
      if (gid && Array.isArray(reply?.capabilityOptOuts) && reply.capabilityOptOuts.length) {
        try { await overrideStore.update(gid, { capabilityOptOuts: reply.capabilityOptOuts }); }
        catch { /* best-effort — a failed prefs write must not break the join */ }
      }
      try { circlesCache = await loadCircles(sources); showLauncher(); } catch { /* */ }
    },
  });
}

// OBJ-2 — Invite to THIS circle: read the current membership code (admin-gated) + encode it as a
// stoop-invite:// QR for another device to scan/paste. Shown in the same modal overlay.
async function showCircleInvite(circleId) {
  const adminPeerAddr = circleHouseholdAgent?.householdSelfAddr ?? null;
  // B · Slice 4 — embed the circle's freedom template in the invite so the joiner can review its
  // opt-outable capabilities at join (see circleConsent.js). Best-effort: a missing policy just omits it.
  let invitePolicy = {};
  try { invitePolicy = (await policyStore.get(circleId)) ?? {}; } catch { /* default — no template embedded */ }
  let r;
  try {
    r = await buildCircleInviteUri({
      callSkill: rawCallSkill, circleId, adminPeerAddr,
      capabilities: invitePolicy.capabilities,
      apps:         invitePolicy.apps,
    });
  }
  catch { r = { error: 'failed' }; }
  const overlay = document.createElement('div');
  overlay.className = 'cc-mydata-modal';
  const card = document.createElement('div');
  card.className = 'cc-mydata-modal__card';
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  const h = document.createElement('h3');
  h.textContent = t('circle.invite.title');
  card.appendChild(h);
  if (!r || r.error || !r.uri) {
    const p = document.createElement('p');
    p.textContent = r?.error === 'admin-only' ? t('circle.invite.admin_only') : t('circle.invite.no_code');
    card.appendChild(p);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 220; canvas.height = 220;
  canvas.style.cssText = 'display:block;margin:10px auto;background:#fff;max-width:220px';
  card.appendChild(canvas);
  import('qrcode').then((m) => (m.default ?? m).toCanvas(canvas, r.uri, { width: 220, margin: 1 }, () => {})).catch(() => { canvas.remove(); });
  const hint = document.createElement('p');
  hint.textContent = t('circle.invite.hint');
  card.appendChild(hint);
  const code = document.createElement('code');
  code.textContent = r.uri;
  code.style.cssText = 'display:block;word-break:break-all;font-size:11px;margin-top:6px;opacity:.7';
  card.appendChild(code);
}

// S5 — reveal the recovery phrase once (stoop `getMnemonicOnce`). Shown in the
// same modal overlay with a destructive warning; the words are never re-fetched.
async function showMnemonicReveal() {
  let res = null;
  try { res = await rawCallSkill('stoop', 'getMnemonicOnce', {}); } catch { res = null; }
  const words = (res && !res.error && (res.mnemonic ?? res.phrase ?? res.words)) || '';
  const overlay = document.createElement('div');
  overlay.className = 'cc-mydata-modal';
  const card = document.createElement('div');
  card.className = 'cc-mydata-modal__card cc-mydata-mnemonic';
  const h = document.createElement('h3');
  h.textContent = t('circle.mydata.mnemonic_title');
  card.appendChild(h);
  if (words) {
    const warn = document.createElement('p');
    warn.className = 'cc-mydata-mnemonic__warn';
    warn.textContent = t('circle.mydata.mnemonic_warn');
    const pre = document.createElement('pre');
    pre.className = 'cc-mydata-mnemonic__words';
    pre.textContent = Array.isArray(words) ? words.join(' ') : String(words);
    card.appendChild(warn);
    card.appendChild(pre);
  } else {
    const empty = document.createElement('p');
    empty.textContent = t('circle.mydata.mnemonic_none');
    card.appendChild(empty);
  }
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'cc-wizard-btn cc-wizard-btn-primary';
  done.textContent = t('circle.mydata.close');
  done.addEventListener('click', () => { try { overlay.remove(); } catch { /* */ } });
  card.appendChild(done);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// cluster K · K2 — the composable LISTS panel: a circle's `list` containers + their `list-item` children,
// rendered nested via projectContainer→renderContainerCard. "+ add" creates a contained child (addChildTo);
// row-actions complete/remove. Self-contained (its own per-circle store) — doesn't touch the kring dispatch.
function openListsPanel(circleId) {
  const overlay = document.createElement('div');
  overlay.className = 'cc-screen-panel';
  const card = document.createElement('div');
  card.className = 'cc-screen-panel__card';
  const head = document.createElement('div');
  head.className = 'cc-screen-panel__head';
  const title = document.createElement('h3');
  title.textContent = t('circle.lists.title');
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'cc-screen-panel__close'; close.textContent = '✕';
  close.addEventListener('click', () => { try { overlay.remove(); } catch { /* */ } });
  head.append(title, close); card.appendChild(head);
  const body = document.createElement('div');
  body.className = 'cc-lists-panel';
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  let openListId = null;     // null = the container index; an id = that container's card
  let pendingAddTo = null;   // container node id awaiting an inline add-input
  let pendingHint = null;    // the chosen child type for the pending input (from the picker), or null = default
  let pendingPick = null;    // { node, kinds } — a container awaiting a TYPE choice (the ambiguous-type picker)

  const typeLabel = (type) => t(`circle.container.type.${type}`, undefined, type);

  async function draw() {
    // L1b — sealed pod-backed lists for this circle when a pod session + sealing strategy exist
    // (else the memoised IDB/memory default). policyStore holds the circle's storagePosture.
    let listsPolicy = null;
    try { listsPolicy = (await policyStore.get(circleId)) ?? {}; } catch { /* default posture */ }
    const svc = await getCircleLists(circleId, listsPolicy);
    body.replaceChildren();
    if (openListId) {
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'cc-lists-panel__back'; back.textContent = `← ${t('circle.lists.title')}`;
      back.addEventListener('click', () => { openListId = null; pendingAddTo = null; pendingPick = null; draw(); });
      body.appendChild(back);
      const tree = await svc.tree(circleId, openListId);
      if (tree) {
        body.appendChild(renderContainerCard(tree, {
          t,
          onAdd: (node) => {
            // K2 type picker: an AMBIGUOUS container (≥2 accepted types, no default) picks the type FIRST;
            // a container with a default goes straight to the input.
            const { ambiguous, kinds } = svc.addKinds(node.type);
            if (ambiguous) { pendingPick = { node, kinds }; pendingAddTo = null; }
            else { pendingAddTo = node.id; pendingHint = null; pendingPick = null; }
            draw();
          },
          onRowAction: async (op, node) => {
            if (op === 'markComplete') await svc.markDone(circleId, node.id);
            else if (op === 'removeItem') await svc.remove(circleId, node.id);
            draw();
          },
        }));
      }
      if (pendingPick) {
        const pick = document.createElement('div');
        pick.className = 'cc-lists-panel__pick';
        const lbl = document.createElement('span'); lbl.className = 'cc-lists-panel__pick-label'; lbl.textContent = t('circle.lists.pick_type');
        pick.appendChild(lbl);
        for (const k of pendingPick.kinds) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'cc-lists-panel__pick-btn'; b.dataset.pickType = k.type; b.textContent = typeLabel(k.type);
          b.addEventListener('click', () => { pendingAddTo = pendingPick.node.id; pendingHint = k.type; pendingPick = null; draw(); });
          pick.appendChild(b);
        }
        body.appendChild(pick);
      }
      if (pendingAddTo) {
        const addForm = document.createElement('form');
        addForm.className = 'cc-lists-panel__add-form';
        const addInput = document.createElement('input');
        addInput.type = 'text'; addInput.className = 'cc-lists-panel__add-input';
        addInput.placeholder = pendingHint ? typeLabel(pendingHint) : t('circle.lists.add_prompt');
        const addSubmit = document.createElement('button');
        addSubmit.type = 'submit'; addSubmit.className = 'cc-lists-panel__create'; addSubmit.textContent = t('circle.lists.create');
        addForm.append(addInput, addSubmit);
        addForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = addInput.value.trim(); const target = pendingAddTo; const hint = pendingHint;
          pendingAddTo = null; pendingHint = null;
          if (v && target) await svc.addItem(circleId, target, v, undefined, hint ? { hint } : undefined);
          draw();
        });
        body.appendChild(addForm);
        setTimeout(() => { try { addInput.focus(); } catch { /* */ } }, 0);
      }
      return;
    }
    // ── the container index: lists AND boards, each with a type badge ──────────────────────────────────
    const containers = await svc.listContainers(circleId);
    if (!containers.length) {
      const empty = document.createElement('div');
      empty.className = 'cc-lists-panel__empty'; empty.textContent = t('circle.lists.empty');
      body.appendChild(empty);
    }
    for (const c of containers) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'cc-lists-panel__list'; row.dataset.listId = c.id; row.dataset.type = c.type;
      const badge = document.createElement('span'); badge.className = 'cc-lists-panel__badge'; badge.textContent = typeLabel(c.type);
      const name = document.createElement('span'); name.textContent = c.text;
      row.append(badge, name);
      row.addEventListener('click', () => { openListId = c.id; draw(); });
      body.appendChild(row);
    }
    // new-container form: a name + two creators (a plain List, or a heterogeneous Board).
    const form = document.createElement('form');
    form.className = 'cc-lists-panel__new';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'cc-lists-panel__new-input'; input.placeholder = t('circle.lists.new');
    const mkList = document.createElement('button');
    mkList.type = 'submit'; mkList.className = 'cc-lists-panel__create'; mkList.textContent = typeLabel('list');
    const mkBoard = document.createElement('button');
    mkBoard.type = 'button'; mkBoard.className = 'cc-lists-panel__create cc-lists-panel__create--alt'; mkBoard.textContent = typeLabel('board');
    const submit = async (kind) => {
      const v = input.value.trim();
      if (!v) return;
      if (kind === 'board') await svc.createBoard(circleId, v); else await svc.createList(circleId, v);
      input.value = ''; draw();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit('list'); });
    mkBoard.addEventListener('click', () => submit('board'));
    form.append(input, mkList, mkBoard);
    body.appendChild(form);
  }
  draw();
}

// S6.B — open a dedicated screen (tasks / agenda) as a dismissable panel, the
// chat-triggered "overview" projection. Reuses the Schermen block materializer +
// renderer (one block, scope:'all'), scoped to the active circle.
async function openCircleScreenPanel(screenId, { highlightRef } = {}) {
  const circleId = getActiveCircle();
  const overlay = document.createElement('div');
  overlay.className = 'cc-screen-panel';
  const card = document.createElement('div');
  card.className = 'cc-screen-panel__card';
  const head = document.createElement('div');
  head.className = 'cc-screen-panel__head';
  const title = document.createElement('h3');
  title.textContent = t(`circle.screen.open.${screenId}`, { defaultValue: t('circle.screen.open_generic') });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cc-screen-panel__close';
  close.setAttribute('aria-label', t('circle.mydata.close'));
  close.textContent = '✕';
  close.addEventListener('click', () => { try { overlay.remove(); } catch { /* */ } });
  head.appendChild(title); head.appendChild(close);
  card.appendChild(head);
  const body = document.createElement('div');
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  renderCircleScreen(body, { blocks: null, t });   // loading

  // D-mig-1b — a declared LIST-SCREEN renders directly (search + category checkboxes + capability-
  // gated row actions) instead of going through the recipe-block path.  Its config is now SOURCED
  // from the projected manifest section (renderWeb's NavModel.sections[]) — not a hardcoded literal.
  const found = sectionForScreen(circleManifestsByOrigin, screenId);
  if (found) {
    const { section, appOrigin } = found;
    const categoryField = section.categoryField;
    const labelField = section.labelField ?? 'label';
    // D-mig-2 — WHICH item fields the text search matches, sourced from the
    // projected section (like categoryField/labelField).  Absent → the
    // consumer defaults to `[labelField]` (label-only search, as before).
    const searchFields = section.searchFields;
    try {
      const res = await rawCallSkill(appOrigin, section.dataSource.skillId, section.dataSource.args ?? {});
      const items = Array.isArray(res?.items) ? res.items : Array.isArray(res?.payload?.items) ? res.payload.items : Array.isArray(res) ? res : [];
      let capabilityMatrix = [];
      try {
        const pol = (await policyStore.get(circleId)) ?? {};
        const ovr = (await overrideStore.get(circleId)) ?? {};
        capabilityMatrix = buildCapabilityMatrix(circleBaseSources, {
          enabledApps: Array.isArray(pol.apps) && pol.apps.length ? pol.apps : null,
          template: pol.capabilities || {}, optOuts: ovr.capabilityOptOuts || [],
        });
      } catch { /* best-effort */ }
      body.innerHTML = '';
      renderListBlock(body, {
        block: { items, categoryField, labelField, searchFields, defaultAudience: section.audience, manifestsByOrigin: circleManifestsByOrigin, appOrigin, title: title.textContent },
        t, capabilityMatrix,
        onRowAction: ({ opId, itemId }) => { try { overlay.remove(); } catch { /* */ } circleDispatchReady?.({ opId, args: { id: itemId } }); },
      });
    } catch { body.textContent = t('circle.screen.empty'); }
    return;
  }

  try {
    const block = { id: `panel-${screenId}`, type: screenId, config: { scope: 'all' } };
    const mat = await materializeBlock({ block, circleId, hostOps: { callSkill: rawCallSkill, eventLog, circles: circlesCache, fetchImpl: circleAuthedFetch || undefined } });
    // highlightRef — when this panel was opened from a "See also" chip, scroll
    // to + flash the referenced item once its block has materialized.
    renderCircleScreen(body, { blocks: [mat], t, highlightRef });
  } catch { renderCircleScreen(body, { blocks: [], t }); }
}

// Theme B — run the guided-setup chatbot in a modal: render one step, feed the
// answer back through submitGuidedStep, and on done apply the collected policy
// patch via onDone (which pre-fills the settings form — the GUI hand-off).
function openGuidedSetupPanel({ onDone } = {}) {
  const template = settingsTemplate;
  let state = startGuidedSetup(template);
  const overlay = document.createElement('div');
  overlay.className = 'cc-screen-panel';   // reuse the panel overlay chrome
  const card = document.createElement('div');
  card.className = 'cc-screen-panel__card';
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const draw = () => renderGuidedSetup(card, {
    template, state, t,
    onAnswer: (answer) => {
      const r = submitGuidedStep(template, state, answer);
      state = r.state;
      if (r.done) {
        try { onDone?.(guidedPolicyPatch(state)); } catch { /* defensive */ }
        try { overlay.remove(); } catch { /* */ }
        return;
      }
      draw();
    },
    onClose: () => { try { overlay.remove(); } catch { /* */ } },
  });
  draw();
}

// S5 — full-size image viewer for a prikbord attachment, in a dismissable overlay.
function showImageModal(src, { pending = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'cc-image-modal';
  const img = document.createElement('img');
  img.className = 'cc-image-modal__img';
  img.src = src;
  img.alt = t('circle.noticeboard.attach');
  overlay.appendChild(img);
  if (pending) {
    const note = document.createElement('div');
    note.className = 'cc-image-modal__note';
    note.textContent = t('circle.noticeboard.attach_fetching');
    overlay.appendChild(note);
  }
  overlay.addEventListener('click', () => { try { overlay.remove(); } catch { /* */ } });
  document.body.appendChild(overlay);
}

// S2 — availability/quiet-hours/hopping (the former Mij body), now a sub-screen of Mij.
async function showAvailability() {
  let working = await availabilityStore.get();
  const rerender = () => renderCircleAvailability(rootEl, {
    availability: working,
    t,
    onChange: (patch) => { working = mergeAvailability(working, patch); rerender(); },
    onSave: async () => { await availabilityStore.update(working); showMij(); },
    onHop: showHop,
  });
  rerender();
  showTabBar('mij');
}

async function createCircle() {
  if (!rawCallSkill) {
    // SP-13.1 — no chat-shell fallback.  Without an agent the bundle
    // hasn't booted yet; surface that as an error and bail.
    globalThis.alert?.(t('circle.create_unavailable'));
    return;
  }
  const name = (globalThis.prompt?.(t('circle.new')) || '').trim();
  if (!name) return;
  try {
    await quickCreateCircle({ callSkill: rawCallSkill, name });
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] create failed', err);
    globalThis.alert?.(String(err?.message ?? err));
  }
  showLauncher();
}

async function showDetail(id) {
  hideCircleTabBar(tabBarEl);
  setActiveCircle(id);
  // OBJ-2 S1c-shell — (re)feed the household sync roster with THIS circle's members
  // so items added here fan out to them. Member-only + deduped; safe to call often.
  feedHouseholdRosterForCircle?.(id)?.catch?.(() => {});
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
  // 52.25 — this circle's embed policy may differ from the last → re-resolve
  // folio /zoek's embedder (or null it for an 'off' circle). Best-effort.
  try { circleSyncFolioNoteEmbedder?.(); } catch { /* /zoek stays lexical */ }
  // P6.3 — bump the seenAt marker so the next launcher render clears
  // this circle's unread badge.
  writeSeenAt(bumpSeenAt(readSeenAt(), id));
  const circle = circlesCache.find((c) => c.id === id) || { id };
  // SP-13.1 — no chat-shell auto-route anymore.  Every kring opens the
  // kring view; v2 §1 says chat IS the kring view (GESPREK tab).  The
  // GESPREK render lands in SP-13.2.
  let detailPolicy = null;
  try { detailPolicy = await policyStore.get(id); }
  catch { /* fresh circle / read failure → fall through */ }
  showKring(id, circle, detailPolicy);
}

// SP-13 — kring content view (board 2B/8C).  Replaces the action-grid
// CircleDetail as the per-circle landing surface.  Admin actions
// (Settings, Mine, ViewAs, …) move into the header `⋯` overflow menu,
// gated on the Functies axis (same gates the old detail used).
//
// SP-13.2 — GESPREK as chat-style: drop the filter-chip row, render
// rows as chat bubbles, wire an inline composer that publishes a
// chat-message event scoped to this circle.  Inbound peer broadcast
// + slash-command parsing land in SP-13.2.1.
function showKring(id, circle, policy) {
  // S6.C deep — scope the bot catalog (tools + slash-suggest) to the apps THIS
  // circle composes (policy.apps); null = all. Re-scopes on every circle-open.
  circleActiveApps = Array.isArray(policy?.apps) ? policy.apps : null;
  try { circleRescopeCatalog?.(); } catch { /* catalog stays at the previous scope */ }
  // D / Surface 2 — `more` is the host's callback bag keyed by manifest action
  // id (NOT a roster: `renderCircleKring` projects the roster + gates from
  // `manifest.actions`).  The feature gate now lives ONCE in the manifest
  // (`requires`), evaluated by the shared `circleActions` selector against this
  // `policy` — so viewAs/files/rules are wired UNCONDITIONALLY here (no local
  // `isFeatureEnabled` pre-filter); the projection hides them when off.
  const more = {
    invite:   () => showCircleInvite(id),
    settings: () => showSettings(id),
    lists:    () => openListsPanel(id),   // K2 — the composable lists/container UI
    contacts: () => openCircleScreenPanel('contacts'),   // B · Slice 3 — the filterable list-screen (GUI entry point)
    override: () => showOverride(id),
    viewAs:   () => showViewAs(id),
    advisor:  () => showAdvisor(id),
    skills:   () => showSkills(id),
    files:    () => showFolio(id),
    rules:    () => showRules(id),
    // α.1d — recipe editor (scherm-mode page composition).  Available
    // to everyone for V0; admin-gating + multi-admin consensus are
    // follow-up slices.
    recipes:  () => showRecipeEditor(id),
    // S3 — group admin (member roster + remove + announcements). The ops are
    // admin-gated server-side; shown to everyone for V0 (a non-admin's action is
    // refused with a notice). Role-gating the menu entry is a follow-up.
    admin:    () => showAdmin(id),
  };
  // SP-13.3 — per-kring bottom tabs derived from policy.features.
  const tabs = buildKringTabs(policy, t);
  let activeTab = DEFAULT_KRING_TAB;
  // SP-13.4 — Chat ↔ Scherm pill state, persisted per circle.  §4 — the
  // admin's policy.view sets the landing surface until the user overrides.
  let viewMode = readViewMode(id, policy);
  // α.1c — materialized scherm blocks (recipe book → blocks).  Null
  // until the async load below resolves; replaces SP-13.4's
  // "scherm_coming" placeholder when present.
  let screenBlocks = null;
  let seq = 0;

  // S1 #1 — noticeboard (prikbord tab). Lazy-loaded when the tab opens. Backed by
  // stoop's `listOpen`/`postRequest`, but SCOPED to THIS circle: `stoopCall` injects
  // the circle id as the stoop scope key on writes and filters list reads to the
  // circle (S4 per-circle restructure — one shared agent, per-circle scope key).
  // S4 — scope stoop ops to this circle AND, for a sealed (p2/p3) circle, transparently
  // seal post bodies at rest / open them on read via the per-circle content strategy.
  const stoopCall = scopeStoopCallSkill(rawCallSkill, id, () => getCircleSealStrategy(id, policy));
  // Stand up this circle's pod producer (sealing identity + control agent for a sealed
  // posture), then seed its group-key roster with members who joined before it was live.
  // Best-effort + fire-and-forget; never blocks the kring.
  ensureCirclePod(id, policy)
    .then((prod) => { if (prod?.controlAgent) return seedCircleRoster({ callSkill: rawCallSkill, circleId: id, router: circleControlAgentRouter }); })
    .catch(() => { /* best-effort; plain shared path on failure */ });
  let noticeboardPosts = [];
  let noticeboardIntent = 'ask';
  let noticeboardBusy = false;
  let noticeboardPendingAttachment = null;   // S5 — { encoded, thumbnail, name } before posting
  let myWebid = null;   // fetched once, best-effort (whoAmI is a stoop skill, not chat-manifested)

  async function ensureMyWebid() {
    if (myWebid !== null) return myWebid;
    try { const r = await rawCallSkill('stoop', 'whoAmI', {}); myWebid = r?.webid ?? r?.webId ?? ''; }
    catch { myWebid = ''; }
    return myWebid;
  }
  const shortWebid = (w) => (typeof w === 'string' && w ? (w.split(/[/#]/).filter(Boolean).pop() || w).slice(0, 18) : '');

  // S6.4 — point the global attachment-fetched hook at THIS circle's reloader.
  noticeboardRefreshHook = loadNoticeboard;

  async function loadNoticeboard() {
    try {
      await ensureMyWebid();
      const res = await stoopCall('stoop', 'listOpen', {});
      // listOpen (no intent) also returns system items (rules / membership) — keep only
      // real asks/offers so the prikbord isn't full of bookkeeping (and other circles').
      const items = (Array.isArray(res?.items) ? res.items : []).filter(isNoticeboardPost);
      noticeboardPosts = items.map((it) => ({
        id:           it.id,
        text:         it.text ?? it.label ?? '',
        type:         it.type ?? it.intent ?? 'ask',
        addedBy:      it.addedBy,
        addedByLabel: shortWebid(it.addedBy),
        mine:         !!(myWebid && it.addedBy === myWebid),
        // S5 — carry inline-image metadata (thumbnail travels; full bytes on demand).
        attachments:  Array.isArray(it.attachments) ? it.attachments
                      : (Array.isArray(it.source?.attachments) ? it.source.attachments : []),
        // embeds[] — the canonical cross-object references (a post → a task /
        // event / other post). Top-level OR stoop-legacy source.embeds.
        embeds:       Array.isArray(it.embeds) ? it.embeds
                      : (Array.isArray(it.source?.embeds) ? it.source.embeds : []),
      }));
    } catch { noticeboardPosts = []; }
    rerender();
    // embeds[] — progressively resolve each embed ref to its live title, then
    // re-render to upgrade the "See also" chips (ref → real title). Best-effort.
    enrichNoticeboardEmbeds();
  }

  async function enrichNoticeboardEmbeds() {
    const circleId = getActiveCircle();
    let changed = false;
    await Promise.all(noticeboardPosts.map(async (p) => {
      if (!Array.isArray(p.embeds) || !p.embeds.length) return;
      const enriched = await enrichEmbedsWithTitles({ callSkill: rawCallSkill, embeds: p.embeds, circleId, fetchImpl: circleAuthedFetch || undefined });
      if (enriched.some((e) => e && e.title)) { p.embeds = enriched; changed = true; }
    }));
    if (changed) rerender();
  }

  // S5 — encode a picked image into the inbound-attachment shape + hold it pending.
  async function noticeboardAttach(file) {
    try {
      const encoded = await encodeImageFile(file);
      if (!encoded) return;
      noticeboardPendingAttachment = { encoded, thumbnail: encoded.thumbnail, name: file?.name || '' };
    } catch (err) {
      globalThis.alert?.(t('circle.noticeboard.attach_failed', { defaultValue: err?.message ?? 'attach failed' }));
      noticeboardPendingAttachment = null;
    }
    rerender();
  }

  async function noticeboardPost({ intent, text, dueAt }) {
    noticeboardBusy = true; rerender();
    const pending = noticeboardPendingAttachment;
    try {
      await stoopCall('stoop', 'postRequest', {
        intent, text,
        ...(dueAt ? { dueAt } : {}),
        ...(pending ? { attachments: [pending.encoded] } : {}),
      });
      noticeboardPendingAttachment = null;   // consumed on success; keep it on failure so the user can retry
    }
    catch { globalThis.alert?.(t('circle.noticeboard.post_failed')); }
    noticeboardBusy = false;
    await loadNoticeboard();
  }

  // S5 — open an attachment full-size. The author has the bytes locally
  // (getAttachmentDataUrl); a recipient triggers a fetch (requestAttachment) and
  // the 'stoop:attachment-fetched' listener re-renders when the bytes arrive.
  async function noticeboardViewAttachment({ post, att }) {
    let res = null;
    try { res = await rawCallSkill('stoop', 'getAttachmentDataUrl', { itemId: post.id, attId: att.id }); }
    catch { res = null; }
    if (res?.dataUrl) { showImageModal(res.dataUrl); return; }
    // No local bytes yet — ask the author for them, show the thumbnail meanwhile.
    try { await rawCallSkill('stoop', 'requestAttachment', { itemId: post.id, attId: att.id }); } catch { /* */ }
    showImageModal(att.thumbnail, { pending: true });
  }

  async function noticeboardAction({ action, post }) {
    try {
      if (action === 'respond') {
        const body = (globalThis.prompt?.(t('circle.noticeboard.respond_prompt')) || '').trim();
        if (!body) return;
        await stoopCall('stoop', 'respondToItem', { itemId: post.id, body });
      } else if (action === 'cancel') {
        await stoopCall('stoop', 'cancelRequest', { requestId: post.id });
      } else if (action === 'report') {
        await stoopCall('stoop', 'reportPost', { itemId: post.id });
      } else if (action === 'markReturned') {
        await stoopCall('stoop', 'markReturned', { requestId: post.id });
      } else if (action === 'mute') {
        // S3 #9 — mute the post's author (local-only; filters the kring stream).
        if (post.addedBy) await rawCallSkill('stoop', 'mutePeer', { peerWebid: post.addedBy });
      } else if (action === 'assign') {
        // S3 #4 — lender assigns a borrower to a lend post.
        const borrowerWebid = (globalThis.prompt?.(t('circle.noticeboard.assign_prompt')) || '').trim();
        if (!borrowerWebid) return;
        await stoopCall('stoop', 'assignLend', { itemId: post.id, borrowerWebid });
      }
    } catch { /* best-effort; the reload reflects the real state */ }
    await loadNoticeboard();
  }

  // δ.2 — fan-out helper.  Used by both the initial send AND the
  // tap-to-retry path from the 'failed' icon.  Re-uses the SAME
  // msgId on retry so receiver-side dedup suppresses any duplicate
  // delivery (the EventLog already idempotents on id).
  function broadcastFanOut({ msgId, text, ts }) {
    // Shared fan-out (Phase 2); onChange = web's rerender.
    broadcastKringFanOut({ rawCallSkill, circleId: id, msgId, text, ts, deliveryStateMap, onChange: rerender });
  }

  const rerender = () => {
    const rows = buildKringStream({
      events:    eventLog.query({ excludeMuted: true }),
      circles:   circlesCache,
      circleId:  id,
    });
    renderCircleKring(rootEl, {
      circle, rows, t,
      // D / Surface 2 — feeds the ⋯ overflow menu's manifest-projected feature gate.
      policy,
      tabs, activeTab,
      viewMode,
      screenBlocks,
      // S6.A — tap an inline manifest button on a bot reply → dispatch its op.
      onEmbedButton: (b) => circleEmbedButtonTap?.(b),
      // tap a "See also" embed chip → open the screen where the item lives (S6.B panel).
      onEmbedOpen: ({ screen, ref }) => { if (screen) openCircleScreenPanel(screen, { highlightRef: ref }); },
      // Composer affordances (classic-shell parity): slash-suggest off the merged catalog + bash history.
      catalog: circleCatalog,
      history: kringInputHistory,
      // Permission gate — chat disabled for this circle ⇒ read-only composer (classic `allowCommands` analog).
      canPost: isFeatureEnabled(policy, 'chat'),
      // S1 #1 — noticeboard surface for the prikbord tab (the view only uses it when active).
      noticeboard: {
        posts:    noticeboardPosts,
        intent:   noticeboardIntent,
        busy:     noticeboardBusy,
        onPost:   noticeboardPost,
        onAction: noticeboardAction,
        onIntent: (it) => { noticeboardIntent = it; rerender(); },
        // S5 — inline image attachments.
        attachment:       noticeboardPendingAttachment,
        onAttach:         noticeboardAttach,
        onClearAttach:    () => { noticeboardPendingAttachment = null; rerender(); },
        onViewAttachment: noticeboardViewAttachment,
      },
      // Multi-field inline form (mobile parity). When a kring dispatch trips needsForm with 2+ missing
      // fields, `circlePendingFormFollowUp` holds the shared `PendingFormFollowUp`; the view renders an
      // inline labelled form. onFormSubmit completes + runs the dispatch, then clears the pending form.
      pendingForm: circlePendingFormFollowUp,
      onFormSubmit: async (values) => {
        const pending = circlePendingFormFollowUp;
        if (!pending) return;
        circlePendingFormFollowUp = null;
        // Echo the user's filled values as a kring bubble (mirrors mobile's form→summary replacement),
        // then complete + dispatch via the same path a typed command takes.
        const summary = (pending.fields || [])
          .map((f) => `${f.label || f.name}: ${values?.[f.name] ?? ''}`)
          .join(' · ');
        if (summary) _kringRender?.userBubble(summary);
        const ready = completeMultiFieldFollowUp({ pending, values });
        if (circleDispatchReady) await circleDispatchReady({ opId: ready.opId, args: ready.args });
        else rerender();
      },
      // δ.2 — read function so the renderer can look up state per row
      // without us having to pass a fresh snapshot through every prop.
      // Locally-sent bubbles read this to decide which icon to render.
      deliveryStateFor: (msgId) => deliveryStateMap.get(msgId),
      localActor: LOCAL_ACTOR,
      // δ.2 — retry on the failed icon tap.  Re-fires the SAME msgId
      // (idempotent receiver-side dedup).  Looks up the original text
      // from the eventLog so we don't have to remember it elsewhere.
      onRetryDelivery: (msgId) => {
        const evt = eventLog.query({ excludeMuted: true })
          .find((e) => e.id === msgId);
        const text = evt?.payload?.text;
        const ts   = evt?.ts ?? Date.now();
        if (typeof text !== 'string' || !text) return;
        broadcastFanOut({ msgId, text, ts });
      },
      onViewMode: (mode) => {
        if (mode !== 'chat' && mode !== 'scherm') return;
        viewMode = mode;
        writeViewMode(id, mode);
        rerender();
      },
      onTab: (tabId) => {
        activeTab = tabId;
        // D1 — count the tab use so the quickActions row reflects reality.
        const f = featureForTabId(tabId);
        if (f) actionFrequency.bump(id, f);
        if (tabId === 'prikbord') loadNoticeboard();   // S1 — lazy-load the buurt posts
        rerender();
      },
      // D1 (§5A) — a "Veel-gebruikt" pill tap.  Bump the feature's count,
      // then route it: a feature with a tab switches to it (in chat view);
      // houseRules opens the rules panel; anything else falls back to the
      // members tab if present.
      onScreenAction: (featureKey) => {
        actionFrequency.bump(id, featureKey);
        if (featureKey === 'houseRules') { more.rules?.(); return; }
        const tabId = featureTabId(featureKey);
        if (tabId) {
          activeTab = tabId;
          viewMode = 'chat';
          writeViewMode(id, 'chat');
          if (tabId === 'prikbord') loadNoticeboard();   // S1
        }
        rerender();
        // Re-materialize so the row's own ordering reflects the new count.
        loadScherm();
      },
      onBack:   showLauncher,
      onSend:   async (text) => {
        const line = String(text ?? '').trim();
        if (!line) return;
        // B · Slice 3 — a slash command opens a declared list-screen (the CHAT entry; the ⋯ menu is the GUI
        // one — peer compilers to the same surface). e.g. "/contacts", "/prikbord".
        const scr = line.match(/^\/(contacts|prikbord)\b/i);
        if (scr && sectionForScreen(circleManifestsByOrigin, scr[1].toLowerCase())) { openCircleScreenPanel(scr[1].toLowerCase()); return; }
        // cluster K — the cross-circle SHARE op, minimal slash surface (rich picker UI deferred; see report).
        //   /shareitem <itemId> [to] <targetCircleId>  — share one item from THIS circle into another's audience
        //   /shared                                    — list what's shared INTO this circle (deny-by-default read)
        // A note bubble to the kring stream (bot actor) reports the result — same _kringRender seam the bot uses.
        const kringNote = (text) => {
          const mid = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}-bot`;
          eventLog.append(kringChatMessageEvent({ msgId: mid, ts: Date.now(), circleId: id, actor: 'bot', text }));
          rerender();
        };
        const shareCmd = line.match(/^\/shareitem\s+(\S+)\s+(?:to\s+)?(\S+)\s*$/i);
        if (shareCmd) {
          const [, itemId, toCircleId] = shareCmd;
          const r = await shareItemIntoCircle({ itemId, fromCircleId: id, toCircleId });
          kringNote(r?.ok
            ? t('circle.share.done', { item: itemId, circle: toCircleId })
            : t('circle.share.failed', { error: r?.error ?? 'unknown' }));
          return;
        }
        // objective L · Phase 2 — share an item OUT to an out-of-circle PERSON (a contact), ALONGSIDE the
        // share-to-circle path above. Opens the recipient picker (pickable contacts by published key);
        // selecting one grants them the canonical item in place (shareItemToPublishedKey). The pointer lands
        // in <targetCircleId> (the op requires a distinct target circle to hold the shared-ref bookkeeping).
        //   /sharewith <itemId> [to] <targetCircleId>
        const shareWithCmd = line.match(/^\/sharewith\s+(\S+)\s+(?:to\s+)?(\S+)\s*$/i);
        if (shareWithCmd) {
          const [, itemId, toCircleId] = shareWithCmd;
          await openRecipientPicker({
            itemId, fromCircleId: id, toCircleId,
            onResult: (r, recip) => kringNote(r?.ok
              ? t('circle.share.to_person_done', { item: itemId, name: recip?.name ?? recip?.id ?? '' })
              : t('circle.share.to_person_failed', { error: r?.error ?? 'unknown' })),
          });
          return;
        }
        // objective L — REVOKE a recipient's canonical access (only meaningful for a `canonical` circle):
        //   /unshareitem <itemId> <recipientWebId>   — rotate the item's group key + ACP-revoke the recipient
        const unshareCmd = line.match(/^\/unshareitem\s+(\S+)\s+(\S+)\s*$/i);
        if (unshareCmd) {
          const [, itemId, recipient] = unshareCmd;
          const r = await unshareItemFromCircle({ itemId, fromCircleId: id, recipient });
          kringNote(r?.ok
            ? t('circle.share.revoked', { item: itemId, recipient })
            : t('circle.share.revoke_failed', { error: r?.error ?? 'unknown' }));
          return;
        }
        if (/^\/shared\b/i.test(line)) {
          const items = await listSharedItems(id);
          kringNote(items.length
            ? t('circle.share.list', { count: items.length })
              + '\n' + items.map(({ item }) => `• ${item.text ?? item.type ?? item.id}`).join('\n')
            : t('circle.share.empty'));
          return;
        }
        // Conversational follow-up: the bot previously asked for a missing field (needsForm → beginFollowUp);
        // THIS message is the answer. Append it, complete the pending dispatch, and run it — don't route it
        // to feedback or re-interpret it as a new command.
        if (circlePendingFollowUp) {
          const pending = circlePendingFollowUp;
          circlePendingFollowUp = null;
          const fMsgId = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}`;
          eventLog.append(kringChatMessageEvent({ msgId: fMsgId, ts: Date.now(), circleId: id, actor: LOCAL_ACTOR, text: line }));
          rerender();
          const ready = completeFollowUp({ pending, text: line });
          if (circleDispatchReady) await circleDispatchReady({ opId: ready.opId, args: ready.args });
          return;
        }
        // Conversational follow-up: the bot just asked a free-text question. Route THIS line back to it —
        // force-addressed so it's interpreted (the prior Q&A threaded as `history`) — instead of fanning
        // out to the kring. So "which list?" → "shopping" continues the conversation, no @assistant needed.
        if (circleAwaitingBotReply && !line.startsWith('/')) {
          const prev = circleAwaitingBotReply;
          circleAwaitingBotReply = null;
          const aMsgId = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}`;
          eventLog.append(kringChatMessageEvent({ msgId: aMsgId, ts: Date.now(), circleId: id, actor: LOCAL_ACTOR, text: line }));
          rerender();
          const addressed = addressesBot(line, CIRCLE_BOT_NAME) ? line : `@${CIRCLE_BOT_NAME} ${line}`;
          const history = [
            { role: 'user', content: prev.query },
            { role: 'assistant', content: prev.question },
          ].filter((m) => m.content);
          if (circleBot) { noteCircleBotTurn(await circleBot.handle(addressed, { id, msgId: aMsgId, ts: Date.now(), history }), line); }
          return;
        }
        // Phase 5 — the feedback bot gets first refusal (owns /feedback, /feedback-stop, the bot's own
        // slash cmds + free text while active); else the circle bot routes the turn (gate → interpret →
        // dispatch), with plain messages fanning out. Both render into the kring stream via _kringRender.
        if (circleFeedbackMount && await circleFeedbackMount.tryHandle(line, id)) { rerender(); return; }
        // Optimistic local append + best-effort peer fan-out. The msgId is shared so receiver-side dedup
        // suppresses any echo. δ.2 tracks delivery state (pending → sent | failed) for the bubble icon.
        const msgId = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}`;
        const ts    = Date.now();
        // A plain typed line fans out to the whole kring → scope 'kring'. (A line the bot
        // intercepts as a command posts its OWN scoped reply; the user's words still went out.)
        eventLog.append(kringChatMessageEvent({ msgId, ts, circleId: id, actor: LOCAL_ACTOR, text: line, scope: 'kring' }));
        rerender();
        if (circleBot) { noteCircleBotTurn(await circleBot.handle(line, { id, msgId, ts }), line); }
        else { broadcastFanOut({ msgId, text: line, ts }); }   // fallback before the bot is built
      },
      onAction: (action /*, row */) => {
        // V0: per-row actions just log.  Wiring each (Ik help / Ik doe ze /
        // Negeer) to its dispatch lands in SP-13.2.1.
        console.info('[kring] action', action.action, 'on row', action.payload?.rowId);
      },
      more,
    });
  };
  // Phase 5 — bridge the (module-level) circle bot + feedback to THIS circle's kring stream, so their
  // replies render here. Reset each time showKring opens a circle.
  _kringRender = {
    circleId: id,
    botBubble: (text, opts) => {
      const mid = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}-bot`;
      // S6.A — opts.buttons ride payload.buttons. scope ('self'|'kring') — a bot reply is
      // private unless it represents a shared action; absent → renderer defaults to 'self'.
      eventLog.append(kringChatMessageEvent({ msgId: mid, ts: Date.now(), circleId: id, actor: 'bot', text, buttons: opts?.buttons, scope: opts?.scope, embeds: opts?.embeds }));
      rerender();
    },
    // Local echo of the user's own line (used by the feedback mount, which consumes the message before the
    // composer's optimistic append). Local-only — NOT fanned out to peers.
    userBubble: (text) => {
      const mid = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}-me`;
      // Local-only echo (feedback mount) — private to you, so default 'self' (no scope set).
      eventLog.append(kringChatMessageEvent({ msgId: mid, ts: Date.now(), circleId: id, actor: LOCAL_ACTOR, text }));
      rerender();
    },
    fanOut: (msgId, text, ts) => broadcastFanOut({ msgId, text, ts: ts ?? Date.now() }),
    // Repaint without appending a bubble — used when module-level kring state changes outside a message
    // (e.g. a multi-field needsForm sets `circlePendingFormFollowUp` and the inline form must appear).
    rerender: () => rerender(),
  };
  rerender();
  // EventLog has no subscribe seam yet; SP-13.2.1 will poll-on-event so
  // inbound peer messages appear without manual re-render.

  // α.1c — load + materialize the active recipe.  Until this resolves,
  // scherm-mode shows the empty-state.  Failure (e.g. corrupt store)
  // falls through to the empty-state too.  D1 re-runs this after a
  // quickActions tap so the row's own ordering reflects the new count.
  async function loadScherm() {
    try {
      const book = await recipeStore.get(id);
      // D1 (§5A) — every scherm leads with the "Veel-gebruikt" row.  When
      // the admin hasn't authored a recipe yet, fall back to an in-memory
      // default that's just the quickActions block (not persisted, so the
      // admin can still start from a clean recipe in the editor).
      const active = getActiveRecipe(book) ?? DEFAULT_SCHERM_RECIPE;
      const blocks = await materializeRecipe({
        recipe:   active,
        circleId: id,
        // D1 — policy + actionFrequency feed the quickActions block. The block
        // materializers call `callSkill(appOrigin, opId, args)` (3-arg), so this
        // MUST be the raw 3-arg dispatch — the 2-arg `resolveCallSkill` resolver
        // would mis-read the appOrigin as the opId (#16: this also un-breaks the
        // tasks/agenda scherm blocks, which had the same latent bug). `stoopCall`
        // keeps the 3-arg contract and scopes the noticeboard block to THIS circle
        // (non-stoop ops pass through unchanged).
        hostOps:  { callSkill: stoopCall, eventLog, circles: circlesCache, policy, actionFrequency, fetchImpl: circleAuthedFetch || undefined },
      });
      screenBlocks = blocks;
      if (getActiveCircle() === id) rerender();
    } catch (err) {
      console.warn('[circleApp] recipe load failed:', err?.message ?? err);
      screenBlocks = [];
      if (getActiveCircle() === id) rerender();
    }
  }
  loadScherm();
}


// Skill editor (board 8) — draft persists locally per circle (cc.circleSkill.<id>);
// "extend the Stoop skill item" is the later real-persistence path.
const skillKey = (id) => `cc.circleSkill.${id}`;
function showSkills(id) {
  let skill = normalizeSkill(null);
  try { const s = localStorage.getItem(skillKey(id)); if (s) skill = normalizeSkill(JSON.parse(s)); } catch { /* default */ }
  const rerender = () => renderSkillEditor(rootEl, {
    skill,
    t,
    onChange: (patch) => { skill = mergeSkill(skill, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: () => {
      try { localStorage.setItem(skillKey(id), JSON.stringify(skill)); } catch { /* ignore */ }
      showDetail(id);
    },
  });
  rerender();
}

// α.1d — recipe editor surface.  Two modes: 'book' (list recipes) and
// 'recipe' (edit one recipe's blocks).  Host owns book + editing-recipe
// id; each mutation persists via recipeStore.update then refreshes the
// in-memory copy + the scherm screenBlocks for whatever circle is open.
function showRecipeEditor(circleId) {
  hideCircleTabBar(tabBarEl);
  let book = { recipes: [], activeId: null };
  let mode = 'book';
  let editingRecipeId = null;
  // γ-next.recipe — pending incoming recipe (set by peer broadcast).
  // Loaded once on mount; cleared after the resolver applies or
  // discards.  When null the editor renders untouched; when set, γ.3
  // wires the per-block modal automatically.
  let incomingRecipe = null;

  const refresh = async () => {
    try { book = await recipeStore.get(circleId); }
    catch { book = { recipes: [], activeId: null }; }
    if (mode === 'recipe' && !book.recipes.some((r) => r.id === editingRecipeId)) {
      mode = 'book'; editingRecipeId = null;
    }
    // γ-next.recipe — pull the cached broadcast (if any).  Editor's
    // resolver decides whether anything actually conflicts; if not,
    // applies straight through.
    try { incomingRecipe = await kringRecipePendingStore.get(circleId); }
    catch { incomingRecipe = null; }
    rerender();
  };

  const apply = async (mutator) => {
    try { book = await recipeStore.update(circleId, mutator); }
    catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    // γ-next.recipe — fan the fresh local recipe out to peers.  Read
    // the just-updated active recipe back so we send the post-mutation
    // shape.  Fire-and-forget; per-peer errors are logged inside.
    try { broadcastActiveRecipe({ circleId, book }); }
    catch (err) { console.warn('[kring-recipe] broadcast scheduling failed:', err?.message ?? err); }
    rerender();
  };

  const clearPending = () => {
    incomingRecipe = null;
    kringRecipePendingStore.clear(circleId).catch(() => { /* ignore */ });
  };

  const rerender = () => {
    renderRecipeEditor(rootEl, {
      book, mode, editingRecipeId, t,
      // γ-next.recipe — broadcast cache → editor → γ.3 resolver.  The
      // resolver is opt-in; when `incomingRecipe` is null the editor
      // renders untouched.  Applied / discarded both clear the cache.
      incomingRecipe,
      recipeStore,
      circleId,
      onIncomingApplied: () => clearPending(),
      onIncomingDiscarded: () => clearPending(),
      onBack:         () => showDetail(circleId),
      onOpenRecipe:   (rid) => { mode = 'recipe'; editingRecipeId = rid; rerender(); },
      onBackToBook:   () => { mode = 'book'; editingRecipeId = null; rerender(); },
      onAddRecipe:    (name) => apply((cur) => addRecipe(cur, name)),
      onRenameRecipe: (rid, name) => apply((cur) => renameRecipe(cur, rid, name)),
      onRemoveRecipe: (rid) => apply((cur) => removeRecipe(cur, rid)),
      onSetActive:    (rid) => apply((cur) => setActiveRecipe(cur, rid)),
      onAddBlock:     (rid, type) => apply((cur) => updateRecipe(cur, rid, (r) => addBlock(r, type))),
      onRemoveBlock:  (rid, bid) => apply((cur) => updateRecipe(cur, rid, (r) => removeBlock(r, bid))),
      onMoveBlock:    (rid, bid, idx) => apply((cur) => updateRecipe(cur, rid, (r) => moveBlock(r, bid, idx))),
      onUpdateBlock:  (rid, bid, patch) => apply((cur) => updateRecipe(cur, rid, (r) => updateBlock(r, bid, patch))),
    });
  };

  refresh();   // initial load + render
}

/**
 * γ-next.recipe — fan the active recipe out to every other kring
 * member via stoop's `broadcastKringRecipe` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastActiveRecipe({ circleId, book }) {
  if (typeof rawCallSkill !== 'function') return;
  const active = book?.recipes?.find?.((r) => r.id === book.activeId);
  if (!active) return;
  const msgId = `kring-recipe-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringRecipe', {
    groupId: circleId,
    recipe:  active,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-recipe] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-recipe] fan-out failed:', err?.message ?? err);
  });
}

// Circle-scoped Folio browser (board 10B) — files come from a circle pod's
// listFiles once wired; empty until then (the scope/normalize is tested).
//
// P6.M8 #350 — share-toggle row (Shared-by-me / Shared-with-me).  Picking
// a toggle re-projects the cached raw `listFiles` result through the
// share-filter substrate; clearing it restores the circle-scoped view.
function showFolio(id) {
  let filter = 'all';
  let shareFilter = null;          // null | 'shared-by-me' | 'shared-with-me'
  let currentPath = '';            // N5 — folder being viewed ('' = root)
  let sourceMode = 'index';        // N5 — 'index' (in-app) | 'pod' (real pod)
  let needsPod = false;            // pod selected but no pod connected yet
  let lastListResult = null;       // raw `listFiles` result for re-projection
  let files = buildCircleFiles({ files: [], circleId: id });
  // B · Slice 4 — the acting member's capability matrix, gating the file-OPEN
  // row action (get × file) the SAME way the list surface gates its row
  // buttons. Built async (below); empty until then ⇒ 'show' (unchanged).
  let capabilityMatrix = [];

  function project() {
    // Pod source — rows ARE the user's pod; no circle-scoping / share lens.
    if (sourceMode === 'pod') {
      files = Array.isArray(lastListResult?.items) ? lastListResult.items : [];
      return;
    }
    if (shareFilter && lastListResult != null) {
      files = sharedFilesFromListFiles(lastListResult, {
        myId:      null,
        myCircles: circlesCache,
        filter:    shareFilter,
      });
    } else if (lastListResult != null) {
      files = circleFilesFromListFiles(lastListResult, id);
    } else {
      files = buildCircleFiles({ files: [], circleId: id });
    }
  }

  function load() {
    if (!resolveCallSkill) return;
    const args = sourceMode === 'pod' ? { source: 'pod' } : {};
    resolveCallSkill('listFiles', args)
      .then((res) => {
        lastListResult = res;
        needsPod = sourceMode === 'pod' && !!res?.needsPod;
        project();
        if (getActiveCircle() === id) rerender();
      })
      .catch(() => { needsPod = sourceMode === 'pod'; if (getActiveCircle() === id) rerender(); });
  }

  // B · Slice 4 — build the member's capability matrix (same inputs the list
  // surface uses at renderListBlock), then re-render so the folio file-OPEN
  // row action greys/hides per the gate. Best-effort: any failure leaves the
  // matrix empty ⇒ 'show' ⇒ behaviour identical to before this slice.
  async function loadCaps() {
    try {
      const pol = (await policyStore.get(id)) ?? {};
      const ovr = (await overrideStore.get(id)) ?? {};
      capabilityMatrix = buildCapabilityMatrix(circleBaseSources, {
        enabledApps: Array.isArray(pol.apps) && pol.apps.length ? pol.apps : null,
        template: pol.capabilities || {}, optOuts: ovr.capabilityOptOuts || [],
      });
    } catch { /* best-effort */ }
    if (getActiveCircle() === id) rerender();
  }

  const rerender = () => renderCircleFolioBrowser(rootEl, {
    files,
    filter,
    shareFilter,
    currentPath,
    sourceMode,
    needsPod,
    t,
    // B · Slice 4 — gate the file-OPEN row action (get × file) for this member.
    capabilityMatrix,
    appOrigin: 'folio',
    // Changing the row set (filter / share toggle) resets folder depth.
    onFilter: (f) => { filter = f; currentPath = ''; rerender(); },
    onShareFilter: (next) => {
      if (next && !FOLIO_SHARE_FILTERS.includes(next)) return;
      shareFilter = next;
      currentPath = '';
      project();
      rerender();
    },
    // N5 — switch the file SOURCE: in-app index ↔ the user's real pod.
    onSourceMode: (mode) => {
      if (mode === sourceMode || (mode !== 'index' && mode !== 'pod')) return;
      sourceMode = mode;
      currentPath = '';
      shareFilter = null;            // share lens is index-only
      lastListResult = null;
      needsPod = false;
      files = sourceMode === 'pod' ? [] : buildCircleFiles({ files: [], circleId: id });
      rerender();
      load();
    },
    // N5 — descend into / climb out of folders derived from file paths.
    onNavigate: (path) => { currentPath = path; rerender(); },
    onBack: () => showDetail(id),
  });
  rerender();
  load();
  loadCaps();   // B · Slice 4 — resolve the capability matrix, then re-render.
}

// Circle rules document (boards 3B/3C) — editor persists per circle
// (cc.circleRules.<id>); "preview" shows the Agree/Decline consent screen.
// Threading the consent into the real join flow is the follow-on.
// γ.2 — routes load/save through rulesStore so the versions adapter
// snapshots every save.  Key shape on disk is unchanged.
async function showRules(id) {
  let doc = await rulesStore.get(id);
  // γ-next.rules — pull the cached broadcast (if any).  Editor's γ.4
  // resolver decides whether anything actually conflicts; if not, it
  // applies straight through.  When the slot is empty `incomingRules`
  // stays null and the editor renders untouched.
  let incomingRules = null;
  try { incomingRules = await kringRulesPendingStore.get(id); }
  catch { incomingRules = null; }

  const clearPending = () => {
    incomingRules = null;
    kringRulesPendingStore.clear(id).catch(() => { /* ignore */ });
  };

  const rerender = () => renderRulesEditor(rootEl, {
    doc,
    t,
    // γ-next.rules — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingRules` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    incomingRules,
    rulesStore,
    circleId: id,
    onIncomingApplied:   () => clearPending(),
    onIncomingDiscarded: () => clearPending(),
    onChange: (patch) => { doc = normalizeRulesDoc({ ...doc, ...patch }); rerender(); },
    onBack: () => showDetail(id),
    // The standalone Agree/Decline preview screen was retired in 5.5d —
    // consent now happens in the create/join wizard.  No `onPreview`.
    onSave: async () => {
      try { await rulesStore.set(id, doc); } catch { /* ignore */ }
      // γ-next.rules — fan the just-saved rules doc out to peers.
      // Fire-and-forget; per-peer errors are logged inside.
      try { broadcastRules({ circleId: id, doc }); }
      catch (err) { console.warn('[kring-rules] broadcast scheduling failed:', err?.message ?? err); }
      showDetail(id);
    },
  });
  rerender();
}

/**
 * γ-next.rules — fan the rules document out to every other kring
 * member via stoop's `broadcastKringRules` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastRules({ circleId, doc }) {
  if (typeof rawCallSkill !== 'function') return;
  if (!doc || typeof doc !== 'object') return;
  const msgId = `kring-rules-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringRules', {
    groupId:  circleId,
    rulesDoc: doc,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-rules] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-rules] fan-out failed:', err?.message ?? err);
  });
}

// Advisor cooldown (≤1 card/month) persists per-circle in localStorage.
const advisorSeenKey = (id) => `cc.advisorShown.${id}`;
function showAdvisor(id) {
  const rerender = () => {
    let lastShownAt = null;
    try { const s = localStorage.getItem(advisorSeenKey(id)); if (s) lastShownAt = Number(s); } catch { /* ignore */ }
    const advice = computeAdvice({
      events: eventLog.query({ excludeMuted: true }),
      circleId: id,
      lastShownAt,
    });
    renderCircleAdvisor(rootEl, {
      advice,
      t,
      onTooBusy: () => { eventLog.append(makeTooBusyEvent({ circleId: id })); rerender(); },
      onDismiss: () => {
        try { localStorage.setItem(advisorSeenKey(id), String(Date.now())); } catch { /* ignore */ }
        rerender();
      },
      onBack: () => showDetail(id),
    });
  };
  rerender();
}

async function showViewAs(id) {
  // F-5.1 — real member directory via the listGroupMembers op (MemberMap);
  // re-running the reveal/openness rules over it is the shared projection.
  let members = [];
  const policy = (await policyStore.get(id))?.revealPolicy ?? 'pairwise';
  let viewer = { kind: 'stranger' };
  const rerender = () => renderCircleViewAs(rootEl, {
    members, policy, viewer, t,
    onPickViewer: (v) => { viewer = v; rerender(); },
    onBack: () => showDetail(id),
  });
  rerender();
  if (resolveCallSkill) {
    try {
      members = normalizeCircleMembers(await resolveCallSkill('listGroupMembers', { groupId: id }));
      if (getActiveCircle() === id) rerender();
    } catch { /* keep empty */ }
  }
}

async function showOverride(id) {
  let working = await overrideStore.get(id);
  // B · Slice 4 — the circle's admin policy tells us which caps are enabled + opt-outable.
  let circlePolicy = {};
  try { circlePolicy = (await policyStore.get(id)) ?? {}; } catch { /* default */ }
  const rerender = () => renderCircleOverride(rootEl, {
    override: working,
    t,
    sources: circleBaseSources,
    policy: circlePolicy,
    onChange: (patch) => { working = mergeMemberOverride(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => { await overrideStore.update(id, working); showDetail(id); },
  });
  rerender();
}

// S3 — group admin panel (member roster + remove + announcements). Reached from
// the kring `⋯` menu. Ops are admin-gated server-side; a refusal surfaces a notice.
async function showAdmin(id) {
  hideCircleTabBar(tabBarEl);
  let members = [];
  let reports = [];
  let muted = [];
  let outboundShares = [];          // objective L — this circle's outbound canonical shares (Stop-sharing rows)
  let outboundCanonical = false;    // circle-level posture gate: only a `canonical` circle can revoke in place
  let busy = false;
  let notice = null;

  async function load() {
    const [mem, rep, mut] = await Promise.all([
      rawCallSkill('stoop', 'listGroupMembers', { groupId: id }).catch(() => null),
      rawCallSkill('stoop', 'listReports', { groupId: id }).catch(() => null),
      rawCallSkill('stoop', 'listMutedPeers', {}).catch(() => null),
    ]);
    members = Array.isArray(mem?.members) ? mem.members : [];
    reports = Array.isArray(rep?.reports) ? rep.reports : [];   // admin-only; {error} → []
    muted = Array.isArray(mut?.peers) ? mut.peers : [];
    // objective L — enumerate what THIS circle has shared OUT (across the known circles) + whether its posture
    // is `canonical` (the only revocable-in-place posture). Both best-effort — a failure just hides the section.
    try {
      outboundShares = await listOutboundShares({
        resolveService: _circleServiceFor,
        fromCircleId: id,
        circleIds: circlesCache.map((c) => c.id),
      });
    } catch { outboundShares = []; }
    try {
      outboundCanonical = isCanonicalPosture(normalizeCirclePolicy(await _circlePolicy(id)).sharePosture);
    } catch { outboundCanonical = false; }
    rerender();
  }
  const rerender = () => renderCircleAdminPanel(rootEl, {
    members, reports, muted, outboundShares, outboundCanonical, busy, notice, t,
    onBack: () => showDetail(id),
    // objective L — "Stop sharing": revoke ONE canonical share in place (rotate key + ACP-revoke). Reuses the
    // same revoke path the /unshareitem slash uses (unshareItemFromCircle → revokeItemShare). Since a
    // shared-ref carries no per-recipient list, we drop the pointer + rotate to the remaining origin roster.
    onStopShare: async (s) => {
      if (!s?.itemId) return;
      notice = null; busy = true; rerender();
      const r = await unshareItemFromCircle({ itemId: s.itemId, fromCircleId: id, toCircleId: s.toCircleId })
        .catch((cause) => ({ ok: false, error: cause?.message ?? 'unknown' }));
      notice = r?.ok
        ? t('circle.share.revoked', { item: s.itemId, recipient: s.toCircleId })
        : t('circle.share.revoke_failed', { error: r?.error ?? 'unknown' });
      busy = false; await load();
    },
    onUnmute: async (key) => {
      try { await rawCallSkill('stoop', 'unmutePeer', key.startsWith('webid:') ? { peerWebid: key.slice(6) } : { peerStableId: key }); } catch { /* */ }
      await load();
    },
    onRemove: async (m) => {
      notice = null; busy = true; rerender();
      let removed = false;
      try {
        const r = await rawCallSkill('stoop', 'removeMember', { groupId: id, memberWebid: m.webid, memberStableId: m.stableId });
        if (r?.error) notice = t('circle.admin.refused');
        else removed = true;
      } catch { notice = t('circle.admin.refused'); }
      // objective L — auto-revoke: on a SUCCESSFUL removal, rotate this circle's outbound canonical shares away
      // from the departing member (reuses revokeAllForMember → revokeItemShare). BEST-EFFORT — a revoke failure
      // must NOT block the removal; surface a count notice instead. remainingRecipients = the remaining members'
      // origin-circle sealing keys (best-effort; empty ⇒ omit and let the enforcement default to the origin roster).
      if (removed && m.webid) {
        try {
          const remaining = (await Promise.all(
            members.filter((x) => x.webid && x.webid !== m.webid).map((x) => recipientSealKeyFor(id, x.webid)),
          )).filter(Boolean);
          const res = await revokeAllForMember({
            resolveService: _circleServiceFor,
            enforcementFor: _shareEnforcementFor,
            policyOf: _circlePolicy,
            fromCircleId: id,
            circleIds: circlesCache.map((c) => c.id),
            recipient: m.webid,
            remainingRecipients: remaining.length ? remaining : undefined,
          });
          if (res.revoked > 0) notice = t('circle.share.member_revoked', { count: res.revoked });
          if (res.failed.length > 0) notice = t('circle.share.member_revoke_failed', { count: res.failed.length });
        } catch { /* best-effort — the removal already succeeded, never block it */ }
      }
      busy = false; await load();
    },
    onAnnounce: async (text) => {
      notice = null; busy = true; rerender();
      try {
        const r = await rawCallSkill('stoop', 'postAnnouncement', { groupId: id, text });
        notice = r?.error ? t('circle.admin.refused') : t('circle.admin.announced');
      } catch { notice = t('circle.admin.refused'); }
      busy = false; rerender();
    },
  });
  rerender();
  load();
}

async function showSettings(id) {
  let working = await policyStore.get(id);
  // §4 storage-policy bridge — remember the pod tier at entry so Save only pushes
  // to stoop when the admin actually changed it; a failed push (admin-only / the
  // one-way downgrade guard / a centralised tier missing its groupPodUri) is
  // surfaced as a note but never blocks the local policy save.
  const baselinePod = working?.pod;
  let storageNote;
  const consensusActive = () => !!working.consensusRequired && (working.admins?.length ?? 0) >= 2;
  // P6.2 — load pending proposals so the banner can surface the count of
  // outstanding "waiting on N admins" approvals on settings entry.
  let pending = await proposalStore.listForCircle(id);
  const pendingCount = () => pending.filter((p) => p.status !== 'ready').length;
  const pendingNote = () => {
    if (pendingCount() === 0) return consensusActive() ? t('circle.settings.pending') : undefined;
    // Build a "waiting on Pieter, Sara" string from the first pending proposal.
    const first = pending.find((p) => p.status !== 'ready');
    const waiting = first ? pendingApprovers(first) : [];
    return waiting.length
      ? t('circle.settings.pending_waiting', { who: waiting.join(', ') })
      : t('circle.settings.pending');
  };
  // γ-next.policy — pull the cached broadcast (if any).  Editor's γ.4
  // resolver decides whether anything actually conflicts; if not, it
  // applies straight through.  When the slot is empty `incomingPolicy`
  // stays null and the editor renders untouched.
  let incomingPolicy = null;
  try { incomingPolicy = await kringPolicyPendingStore.get(id); }
  catch { incomingPolicy = null; }

  const clearPending = () => {
    incomingPolicy = null;
    kringPolicyPendingStore.clear(id).catch(() => { /* ignore */ });
  };

  // B · consent-card — the recipe reviewed in the consent card (cached between review + Agree so the loaded
  // recipe is reused for apply, avoiding a second load/verify round-trip).
  let _reviewedRecipe = null;

  // D / SP-3b consumer-switch — the settings header is now sourced from the
  // manifest PAGE projection.  renderWeb(canopyChatManifest) projects the
  // `settings` op's `surfaces.page` into pages[]; pageForOp selects it and its
  // labelKey → t() drives the header label (invariant #4 — the manifest is the
  // source of truth for surfaces; no more hardcoded tr('circle.settings.title')).
  const settingsPage = pageForOp(canopyChatManifest, 'settings');

  const rerender = () => renderCircleSettings(rootEl, {
    policy: working,
    t,
    // D / SP-3b — the projected PAGE surface drives the header label (Q22 labelKey via t()).
    settingsPage,
    // B · Slice 2 — the merged manifest sources drive the settings form + the per-skill freedom matrix.
    sources: circleBaseSources,
    saveLabel: consensusActive() ? t('circle.settings.send_proposal') : undefined,
    note: [pendingNote(), storageNote].filter(Boolean).join(' · ') || undefined,
    // γ-next.policy — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingPolicy` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    incomingPolicy,
    policyStore,
    circleId: id,
    // OBJ-2 — paired devices (no-pod sync). Only wired when the agent exposes the household
    // sync hooks; add/remove persist + return the updated roster (the panel re-draws itself).
    householdSelfAddr:     circleHouseholdAgent?.householdSelfAddr ?? null,
    householdPeers:        circleHouseholdAgent?.listHouseholdPeers?.(id) ?? [],   // THIS circle's roster
    onAddHouseholdPeer:    typeof circleHouseholdAgent?.pairWithPeer === 'function'
      ? (addr) => circleHouseholdAgent.pairWithPeer(id, addr)        // mutual + per-circle: pair into THIS circle
      : (typeof circleHouseholdAgent?.addHouseholdPeer === 'function'
        ? (addr) => circleHouseholdAgent.addHouseholdPeer(id, addr) : undefined),
    onRemoveHouseholdPeer: typeof circleHouseholdAgent?.removeHouseholdPeer === 'function'
      ? (addr) => circleHouseholdAgent.removeHouseholdPeer(id, addr) : undefined,
    onIncomingApplied:   () => clearPending(),
    onIncomingDiscarded: () => clearPending(),
    onChange: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    // Theme B — the guided-setup chatbot: walk the basics, then pre-fill these
    // fields (the user still reviews + Saves). Template is remote-loadable; bundled fallback.
    onGuidedSetup: () => openGuidedSetupPanel({
      onDone: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    }),
    // B · consent-card — REVIEW an authored recipe BEFORE applying: load + build the review model (what it
    // would enable + the opt-outable caps). Nothing is persisted here; circleSettings shows the consent card.
    // The loaded recipe is cached so Agree reuses it (no double-load, no divergence).
    onReviewRecipe: async (source) => {
      const res = await loadRecipeForReview({
        source, sources: circleBaseSources, policy: working,
        fetch: circleAuthedFetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined),
      });
      if (!res.ok) return { ok: false, message: t('circle.recipeApply.error') };
      _reviewedRecipe = { source, recipe: res.recipe, model: res.model };
      return { ok: true, model: res.model, recipe: res.recipe };
    },
    // B · consent-card — AGREE: apply the REVIEWED recipe with the user's declined optional caps. All-or-
    // nothing through the SAME store + gate (applyReviewedRecipe → applyRecipeToCircle → policyStore.update);
    // the declined caps become this member's `capabilityOptOuts` via the existing override-store seam, so the
    // gate's effective set = the recipe allowlist MINUS the declined optional caps. No bypass, no fork.
    onApplyRecipe: async (source, { declinedKeys = [], recipe, model } = {}) => {
      const reviewed = (_reviewedRecipe && _reviewedRecipe.source === source) ? _reviewedRecipe : null;
      const useRecipe = recipe ?? reviewed?.recipe;
      const useModel  = model  ?? reviewed?.model;
      if (!useRecipe || !useModel) return t('circle.recipeApply.error');
      const res = await applyReviewedRecipe({
        circleId: id, recipe: useRecipe, model: useModel, declinedKeys,
        sources: circleBaseSources, policyStore,
        // Record the member's declined optional caps as capabilityOptOuts (the seam the gate honours).
        recordOptOuts: (optOuts) => overrideStore.update(id, { capabilityOptOuts: optOuts }),
      });
      if (!res.ok) return t('circle.recipeApply.error');
      _reviewedRecipe = null;
      // The recipe is now persisted; sync the edit buffer + redraw so the toggles reflect it.
      working = res.policy;
      rerender();
      return t('circle.recipeApply.applied');
    },
    onBack: () => showDetail(id),
    onSave: async () => {
      if (!consensusActive()) {
        await policyStore.update(id, working);
        // γ-next.policy — fan the just-saved policy doc out to peers.
        // Fire-and-forget; per-peer errors are logged inside.
        try { broadcastPolicy({ circleId: id, policy: working }); }
        catch (err) { console.warn('[kring-policy] broadcast scheduling failed:', err?.message ?? err); }
        // §4 storage-policy bridge — when the pod tier changed, drive stoop's
        // authoritative circle storage policy. The skill owns admin-gating + the
        // one-way guard; on failure we keep the local save and show a note.
        if (working?.pod !== baselinePod && typeof rawCallSkill === 'function') {
          const res = await pushCircleStoragePolicy({
            callSkill: rawCallSkill, circleId: id, pod: working.pod, groupPodUri: working.groupPodUri,
          });
          if (!res.ok) {
            const key = `circle.settings.storage_err.${res.error}`;
            const msg = t(key);
            storageNote = (msg && msg !== key) ? msg : t('circle.settings.storage_err.generic');
            rerender();
            return;   // stay on settings so the admin sees why the tier didn't take
          }
        }
        showDetail(id);
        return;
      }
      // P6.2 — record + persist the pending proposal.  Cross-admin
      // delivery (NKN fan-out + receive handler) is the V1 follow-up;
      // single-device approval works on-device today via approveProposal +
      // proposalStore.updateOne, and unanimous-approve commits via
      // policyStore.update + proposalStore.remove.
      const proposal = makeProposal({
        circleId: id, patch: working, proposedBy: null, policy: working,
      });
      await proposalStore.save(proposal);
      if (proposal.status === 'ready') {
        // Single admin / self-only consensus → commit immediately.
        await policyStore.update(id, working);
        await proposalStore.remove(proposal.id);
        // γ-next.policy — fan the just-committed policy doc out to peers.
        // Only fires when consensus actually resolves on-device (i.e. the
        // proposal landed as `ready`); for outstanding multi-admin
        // proposals the broadcast follows the unanimous-approve commit
        // path (cross-admin proposal-delivery is a V1 follow-up).
        try { broadcastPolicy({ circleId: id, policy: working }); }
        catch (err) { console.warn('[kring-policy] broadcast scheduling failed:', err?.message ?? err); }
      } else {
        pending = await proposalStore.listForCircle(id);
      }
      // P6.2 #341 — refresh the launcher's voorstellen badge map so the
      // tile reflects the new pending count on the next launcher visit.
      refreshLauncherProposals().catch(() => { /* ignore */ });
      showDetail(id);
    },
  });
  rerender();
}

/**
 * γ-next.policy — fan the policy document out to every other kring
 * member via stoop's `broadcastKringPolicy` skill.  Fire-and-forget:
 * per-peer failures land in the result.errors array; we just log.
 * No-op when rawCallSkill isn't bound yet (pre-agent-boot edits).
 */
function broadcastPolicy({ circleId, policy }) {
  if (typeof rawCallSkill !== 'function') return;
  if (!policy || typeof policy !== 'object') return;
  const msgId = `kring-policy-${circleId}-${Date.now()}`;
  const ts    = Date.now();
  rawCallSkill('stoop', 'broadcastKringPolicy', {
    groupId: circleId,
    policy,
    msgId,
    ts,
  }).then((r) => {
    if (r?.error) console.warn('[kring-policy] fan-out skipped:', r.error);
  }).catch((err) => {
    console.warn('[kring-policy] fan-out failed:', err?.message ?? err);
  });
}

async function boot() {
  rootEl = document.getElementById('circle-root');
  tabBarEl = document.getElementById('circle-tabbar');
  // App language: a persisted user choice (the Mij toggle) wins over the device locale.
  let _storedAppLang = null; try { _storedAppLang = localStorage.getItem('circle.app.lang'); } catch { /* no storage */ }
  await initLocalisation({ lng: (_storedAppLang === 'nl' || _storedAppLang === 'en') ? _storedAppLang : detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  // S5 — register the web-push service worker (root-scoped /sw.js). Best-effort:
  // it makes `serviceWorker.ready` resolve so the My-data push toggle can read
  // live subscription state; actual subscription happens on user opt-in.
  try { navigator.serviceWorker?.register('/sw.js').catch(() => {}); } catch { /* unsupported */ }

  // S6.C — load the per-user surface preference (how the bot shows actions).
  circleSurfacePref.hydrate().catch(() => {});

  // S4 circle OIDC — complete an incoming Solid sign-in redirect / restore a saved session
  // (reuses src/web/podAuth.js). When signed in, sealed circles + stoop's items route to the
  // user's real pod (the pod root via the canonical discoverPodRoot).
  let podSession = null;
  try {
    podSession = (await podAuth.handleRedirect().catch(() => null)) || podAuth.getCurrentSession?.();
    const podRoot = podSession ? await discoverPodRoot(podSession).catch(() => null) : null;
    circleRealPodRouting = realPodRouting(podSession, { PodClient, SolidOidcAuth, podRoot });
    // embed-ref resolution reads the user's own private-pod items with this fetch.
    circleAuthedFetch = (podSession && typeof podSession.fetch === 'function') ? podSession.fetch : null;
    circleOwnerWebId  = podSession?.webid ?? null;
    if (typeof window !== 'undefined') {
      window.canopyPodSession = podSession ?? null;               // debug / e2e seam
      window.canopyPodSignIn = (issuer) => podAuth.startSignIn({ issuer, redirectUrl: window.location.href });
    }
  } catch { /* not signed in → pseudo-pod */ }

  try {
    let eventSeq = 0;
    const publishEventToLog = (e) => {
      if (!e || typeof e !== 'object') return;
      eventLog.append({
        ...e,
        id: e.id ?? `cc-${Date.now()}-${(eventSeq += 1).toString(36)}`,
        ts: e.ts ?? Date.now(),
      });
    };
    const agent = await createRealHouseholdAgent({
      publishEvent: publishEventToLog,
      // PERSISTENT chat identity (the secure-agent peer address). Without a persistent vault the
      // identity is in-memory and ROTATES on every page reload — so this device's address changes,
      // the circle roster's recorded address goes stale, and peers can no longer reach it (no-pod
      // sync silently dies after a refresh). localStorage-backed, same 'cc-chat-id:' prefix the
      // mobile bundle uses (VaultAsyncStorage) → stable address across reloads, web≡mobile.
      chatVault: new VaultLocalStorage({ prefix: 'cc-chat-id:' }),
      stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
      // OBJ-2 S1e (web) — persist the household store in IndexedDB so items survive
      // a reload (mobile already threads its AsyncStorage descriptor). Parity with stoop.
      householdPersistDb: { dbName: 'cc-household-state', storeName: 'items' },
      stoopControlAgent: circleControlAgentRouter,   // S4 — multi-member sealing on redeem/leave
      getActiveCircleId: getActiveCircle,            // per-circle store scoping — the active circle scopes chat ops
      // L3 — household routes through the uniform wired path (dissolved cores over the per-circle
      // CircleItemStore) by default; the legacy registry is retired. No flag: it's unconditional now.
    });
    circleHouseholdAgent = agent;   // OBJ-2 — expose to showSettings (sibling fn) for the paired-devices panel
    // 52.25 — wire folio `/zoek`'s SEMANTIC embedder from the ACTIVE circle's
    // embed policy (embedTool ?? llmTool), reusing the SAME resolution the
    // circle retriever uses (`resolveCircleEmbedder` over the live
    // `embedProviders`). Injects `null` for policy 'off'/unconfigured → `/zoek`
    // stays lexical-only, and NO embed call is ever made (invariant #7: same
    // trust boundary + policy gate as the chat LLM). Re-run on circle switch
    // (showDetail) and on a settings change (circleApplyUserLlm).
    circleSyncFolioNoteEmbedder = async () => {
      if (typeof agent?.setFolioNoteEmbedder !== 'function') return;
      let embedder = null;
      try {
        embedder = resolveCircleEmbedder({ circlePolicy: await policyFor(), userDefault, providers: embedProviders });
      } catch { embedder = null; }
      agent.setFolioNoteEmbedder(embedder || null);
    };
    circleSyncFolioNoteEmbedder();
    // OBJ-2 — joiner-side peer-redeem sender (shared factory), correlated by circlePendingRedeems.
    circleSendPeerRedeem = makeSendGroupRedeemRequest({
      sendPeer:        (addr, payload) => agent.sendPeerMessage(addr, payload),
      isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
      pendingMap:      circlePendingRedeems,
    });
    // S4 — when signed in, route stoop's items to the user's REAL pod (parity with
    // folio/calendar; reuses stoop's already-built pod-routing write-through). Best-effort.
    if (podSession?.isLoggedIn && circleRealPodRouting?.podRoot && typeof agent.attachStoopPod === 'function') {
      agent.attachStoopPod({ podRoot: circleRealPodRouting.podRoot, webid: podSession.webid, fetch: podSession.fetch })
        .then((r) => { if (!r?.ok && r?.error) console.warn('[circleApp] attachStoopPod:', r.error); })
        .catch(() => { /* best-effort; stays local-first */ });
    }
    // S6.4 — refresh the on-screen noticeboard when a recipient's requested
    // attachment bytes land (stoop:attachment-fetched). Subscribed once; the hook
    // points at the active circle's loader.
    try { agent.onStoopEvent?.('stoop:attachment-fetched', () => { try { noticeboardRefreshHook?.(); } catch { /* */ } }); } catch { /* */ }
    if (typeof agent?.callSkill === 'function') {
      // Calendar cross-peer fan-out — wrap the bare callSkill so a successful
      // calendar dispatch (schedule/RSVP) fans its invite/RSVP envelopes out
      // over NKN, parity with the classic web shell. Gated on the peer
      // transport being connected; a no-op otherwise.
      rawCallSkill = withCalendarOutbound(agent.callSkill, {
        sendPeer: (addr, payload) => agent.sendPeerMessage(addr, payload),
        // transport-NEUTRAL: true if NKN OR relay is up (sendPeerMessage routes
        // over whichever; keying on peer.status alone wrongly skips on relay).
        isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
        publishEvent: publishEventToLog,
      });
      // Route the auto-resolving callSkill through the calendar-wrapped one too,
      // so button-driven calendar dispatches fan out as well as the bot path.
      // Pass a catalog GETTER so the resolver skips origins that don't declare the
      // op (no probe-storm) AND honours later rescopes (app toggle / policy.apps).
      // BUGFIX: `catalog` is a LOCAL of buildCircleBot (defined far below + only after
      // buildCircleBot runs); referencing it here threw ReferenceError on every resolved
      // call, so the catalog getter crashed → loadCircles silently returned [] → circles
      // never appeared even though createGroupV2 + listMyBuurts worked. Use the module-level
      // `circleCatalog` (null until buildCircleBot sets it; makeResolvingCallSkill tolerates
      // a null catalog by trying all origins).
      resolveCallSkill = makeResolvingCallSkill(rawCallSkill, DEFAULT_CIRCLE_ORIGINS, () => circleCatalog);
      sources = circleSourcesFromAgent({ callSkill: resolveCallSkill, circlesStore: agent.circlesStore });
      // Phase 5 — build the kring composer's bot + feedback now that the agent (and its manifest) is up.
      try { buildCircleBot(agent); } catch (err) { console.warn('[circleApp] circle bot setup failed:', err?.message ?? err); }
      // SP-13.2.1 — register a peer-router with the kring-chat-message
      // handler + connect the NKN transport (best-effort; no-op when
      // nkn-sdk failed to load).  The ingest hook mirrors the envelope
      // into stoop's itemStore so kring chat history is durable,
      // searchable, and mute/eviction-filtered (parity with /post
      // delivery via `ingestRemotePost`).  EventLog append still drives
      // the live bubble render.
      const ingestKringMessage = async (payload, fromPeerAddr) => {
        try {
          return await agent.callSkill('stoop', 'ingestKringMessage', {
            payload, fromPeerAddr,
          });
        } catch (err) {
          console.warn('[circleApp] ingestKringMessage failed:', err?.message ?? err);
          return { error: String(err?.message ?? err) };
        }
      };
      // ε.1 — single normalization gate.  Every kring-chat insert
      // path (receiver / rehydrator / future catch-up / pod) routes
      // through this inbox so envelope validation + msgId dedup +
      // ingest mirror + eventLog append happen in ONE place with
      // shared state.  Sibling of `eventLog` so the rehydrator's
      // backfill + the live NKN handler dedupe through the same LRU.
      const kringChatInbox = createChatMessageInbox({
        eventLog,
        ingest: ingestKringMessage,
        logger: console,
      });
      const kringChatHandler = makeKringChatPeerHandler({ inbox: kringChatInbox });
      // SP-13.2.2 — boot rehydrator: read stoop's stored chats back
      // into the in-memory eventLog so the GESPREK tab shows history
      // after a reload (eventLog is in-memory; itemStore persists).
      rehydrateKringChatsFromStoop({
        callSkill: agent.callSkill,
        inbox:     kringChatInbox,
      }).catch(() => { /* logged inside */ });
      // γ-next.recipe — recipe-broadcast receiver.  Stashes inbound
      // recipes per-kring; the editor pulls on mount + passes via
      // γ.3's `incomingRecipe` opt.
      const kringRecipeDedup   = new Set();
      const kringRecipeHandler = makeKringRecipePeerHandler({
        pendingStore: kringRecipePendingStore,
        dedup:        kringRecipeDedup,
        logger:       console,
      });
      // γ-next.rules — rules-broadcast receiver.  Stashes inbound rules
      // docs per-kring; the rules editor pulls on mount + passes via
      // γ.4's `incomingRules` opt.
      const kringRulesDedup    = new Set();
      const kringRulesHandler  = makeKringRulesPeerHandler({
        pendingStore: kringRulesPendingStore,
        dedup:        kringRulesDedup,
        logger:       console,
      });
      // γ-next.policy — policy-broadcast receiver.  Stashes inbound policy
      // docs per-kring; the settings editor pulls on mount + passes via
      // γ.4's `incomingPolicy` opt.  Completes the γ-next trio
      // (recipe / rules / policy).
      const kringPolicyDedup   = new Set();
      const kringPolicyHandler = makeKringPolicyPeerHandler({
        pendingStore: kringPolicyPendingStore,
        dedup:        kringPolicyDedup,
        logger:       console,
      });
      // ε.4 — negotiated catch-up protocol.  The receiver coordinator
      // fires `catch-up-request` to known peers, collects offers in a
      // 3s window, auto-accepts the first, and ingests chunks through
      // the SAME kringChatInbox the receiver/rehydrator use (shared
      // LRU + ingest mirror = no double bubbles).  The provider
      // handler answers inbound requests: fetches via getMessagesSince,
      // sends an offer, then streams chunks on accept.
      //
      // Status emitter is wired to the chat-shell indicator below
      // (ε.5).  Provider notification is V1 auto-approve (no UI yet);
      // policy.catchUpAutoApprove=false opt-out path surfaces a
      // banner through emitCatchUpNotification (also ε.5).
      const sendToPeerForCU = (addr, env) =>
        (typeof agent?.sendPeerMessage === 'function')
          ? agent.sendPeerMessage(addr, env)
          : Promise.reject(new Error('agent.sendPeerMessage unavailable'));

      const catchUpReceiver = makeCatchUpReceiver({
        sendToPeer: sendToPeerForCU,
        inbox:      kringChatInbox,
        emitStatus: (status) => emitCatchUpStatus(status),
        // ε.6 — opt-in multi-offer chooser.  Reads
        // `policy.catchUpChooserMode` synchronously from localStorage
        // (where `localStoragePolicyIo` writes its JSON).  The async
        // policyStore.get() would need to be awaited inside a non-async
        // hook signature; reading localStorage directly is cheap and
        // matches the same source-of-truth the store reads.
        getChooserMode: (groupId) => {
          try {
            const raw = (typeof window !== 'undefined' && window.localStorage)
              ? window.localStorage.getItem(`cc.circlePolicy.${groupId}`)
              : null;
            if (!raw) return 'auto';
            const parsed = JSON.parse(raw);
            return parsed?.catchUpChooserMode === 'prompt' ? 'prompt' : 'auto';
          } catch { return 'auto'; }
        },
        chooseOffer: (offers, { circleId }) => new Promise((resolve) => {
          const circle = circlesCache.find((c) => c.id === circleId);
          const overlay = document.createElement('div');
          document.body.appendChild(overlay);
          renderCatchUpChooser(overlay, {
            offers,
            circleId,
            circleName: circle?.name ?? circleId,
            // V1 contact-resolver: short-addr fallback is fine here —
            // member-directory resolution lands in a follow-up slice.
            resolveContact: null,
            t,
            onResolve: (decision) => {
              try { overlay.remove(); } catch { /* defensive */ }
              resolve(decision);
            },
          });
        }),
        logger:     console,
      });
      const catchUpProvider = makeCatchUpProviderHandler({
        callSkill:        agent.callSkill,
        sendToPeer:       sendToPeerForCU,
        getCirclePolicy:  async (groupId) => policyStore.get(groupId).catch(() => null),
        // V1: every member of a kring is "known"; provider notification
        // surfaces only when policy.catchUpAutoApprove === false.
        isKnownContact:   () => true,
        emitNotification: (n) => emitCatchUpNotification(n, catchUpProvider),
        logger:           console,
      });

      const peerMessageRouter = makePeerRouter({
        handlers: {
          'kring-chat-message':      kringChatHandler,
          'kring-recipe-broadcast':  kringRecipeHandler,
          'kring-rules-broadcast':   kringRulesHandler,
          'kring-policy-broadcast':  kringPolicyHandler,
          // ε.4 — negotiated catch-up subtypes.
          'catch-up-request':        catchUpProvider.handler,
          'catch-up-accept':         catchUpProvider.onAccept,
          'catch-up-offer':          catchUpReceiver.onPeerMessage,
          'catch-up-chunk':          catchUpReceiver.onPeerMessage,
          'catch-up-end':            catchUpReceiver.onPeerMessage,
          // Calendar INBOUND — receive what the fan-out sends. invite persists
          // the event locally (→ shows on the calendar surface) + a kring
          // heads-up; rsvp/cancel apply to local calendar state. (A richer
          // time-card-with-RSVP-buttons bubble in the kring is a follow-up.)
          'calendar-invite':         makeHandleCalendarInvite({
            callSkill:     rawCallSkill,
            addMainBubble: (bubble) => {
              const title = bubble?.embed?.snapshot?.title;
              if (title) _kringRender?.botBubble(t('circle.calendar.invited', { title }));
            },
            publishEvent:  publishEventToLog,
          }),
          'calendar-rsvp':           makeHandleCalendarRsvp({ callSkill: rawCallSkill, publishEvent: publishEventToLog }),
          'calendar-cancel':         makeHandleCalendarCancel({ callSkill: rawCallSkill, publishEvent: publishEventToLog }),
          // a peer shared a file → announce it in the kring with a [Download] button (bytes ride in the
          // embed; we stash them so the tap can save). Classic parity (handleFileShare).
          'file-share':              makeHandleFileShare({
            addMainBubble: (bubble) => {
              const f = bubble?.embed?.snapshot;
              if (!f?.id || !f?.name || !f?.dataB64) return;
              _fileShareInbox.set(f.id, f);
              _kringRender?.botBubble(t('circle.fileShare.received', { name: f.name }),
                { buttons: [{ action: `file-dl:${f.id}`, label: t('circle.fileShare.download') }] });
            },
            publishEvent: publishEventToLog,
          }),
          // SILENT out-of-circle delivery — a peer pushed a sealed COPY straight to us. Land it in the per-user
          // "shared with me" store; the surface opens each with this device's own network-derived sealing key.
          'shared-copy':             makeHandleSharedCopy({
            store:        sharedWithMeStore,
            publishEvent: publishEventToLog,
          }),
          // OBJ-2 membership — the no-pod join handshake (shared core, same as the classic shells):
          // admin verifies an incoming redeem + replies; joiner resolves the pending request on response.
          'group-redeem-request':    makeHandleGroupRedeemRequest({ callSkill: rawCallSkill, sendPeer: (addr, payload) => agent.sendPeerMessage(addr, payload), publishEvent: publishEventToLog }),
          'group-redeem-response':   makeHandleGroupRedeemResponse({ pendingMap: circlePendingRedeems }),
          // P5 — a contact-bot's reply in its 1:1 DM thread (guarded: the channel
          // is null if buildCircleBot threw, and must not break the peer router).
          // S1 #3 — also handle an inbound PEER DM (contact-msg): a person's message
          // lands in the thread with them (onContactReply routes by sender addr).
          ...(circleContactChannel
            ? {
                [circleContactChannel.subtypes.in]:  circleContactChannel.replyHandler(onContactReply),
                [circleContactChannel.subtypes.out]: circleContactChannel.messageHandler(onContactReply),
              }
            : {}),
        },
      });
      _peerAgent = agent; _peerRouter = peerMessageRouter;   // for applyRelayUrl (live relay reconnect)
      tryConnectPeerTransport(agent, peerMessageRouter).catch(() => { /* logged inside */ });

      // ε.4 — auto-fire negotiated catch-up on (re)connect, ONCE per
      // boot.  For each kring we know about, schedule via the strategy
      // router: pod-shared kringen route through the pod range-query;
      // personal/none kringen route through `catchUpReceiver` (the
      // negotiated path).  knownPeers come from stoop's roster.
      const peerCatchUpNegotiated = async ({ circleId, sinceTs }) => {
        let roster = [];
        try {
          const r = await agent.callSkill('stoop', 'listGroupRoster', { groupId: circleId });
          roster = Array.isArray(r?.members) ? r.members : [];
        } catch { /* roster empty */ }
        const knownPeers = roster.map((m) => m?.addr).filter(Boolean);
        return catchUpReceiver.requestCatchUp({
          circleId,
          sinceTs:    Number.isFinite(sinceTs) ? sinceTs : 0,
          knownPeers,
          fromPeerAddr: agent?.peer?.address ?? '',
        });
      };
      // The kick-off itself is scheduled once peer transport reports
      // 'connected'.  We don't await — failures log + the next boot
      // re-tries.  Reuse the existing makeRequestCatchUpFromKnownPeers
      // dispatcher so the per-kring scheduleCatchUp routing stays in
      // one place.
      const requestCatchUpAll = makeRequestCatchUpFromKnownPeers({
        callSkill:             agent.callSkill,
        sendPeer:              sendToPeerForCU,
        inbox:                 kringChatInbox,
        getCirclePolicy:       (id) => policyStore.get(id).catch(() => null),
        peerCatchUpNegotiated,
        logger:                console,
      });
      // OBJ-2 S1c-shell — feed the household no-pod sync roster from a circle's
      // MEMBERS (the stoop group roster = people with reachable peer addrs), NOT
      // the bot contacts: a bot must never receive household items. `addHouseholdPeer`
      // dedupes, so repeated calls (re-open, reconnect) are safe; the mirror only
      // fans out once peers are present. Reuses the exact member source the
      // catch-up path uses (`listGroupRoster` → `members[].addr`).
      feedHouseholdRosterForCircle = (circleId) => feedHouseholdRoster({ agent, circleId });

      // Fire after a short delay so the NKN HI handshake settles.
      // 1.5s mirrors web/main.js's existing kick-off timing.
      setTimeout(() => {
        requestCatchUpAll().catch((err) =>
          console.warn('[catch-up] kick-off failed', err?.message ?? err));
        // Seed the household roster for the active circle (re-fed on open below).
        feedHouseholdRosterForCircle(getActiveCircle()).catch(() => {});
      }, 1500);
      // P6.5 — wire the claim-router hook now that callSkill + override
      // store are both available.  On claim with `tasksToPersonal` on,
      // mirror the claimed task into the primary circle so it shows up in
      // "Mijn dingen".  Uses the existing primary circle (`cc-default`);
      // future slice (P6.5-followup) will surface the resulting mirror
      // tasks in an "ON YOUR LIST" section on the circle detail.
      if (typeof agent.setAfterClaimHook === 'function') {
        agent.setAfterClaimHook(makeAfterClaimHook({
          getOverride:       (id) => overrideStore.get(id),
          resolveCircleName: async (id) => circlesCache.find((c) => c.id === id)?.name ?? null,
          addToPersonalCircle: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
            try {
              return await agent.callSkill('tasks', 'addTask', {
                text,
                circleId:           'cc-default',
                originCircleId,
                originCircleName,
                originTaskId,
                tags:             [tag],
              });
            } catch (err) {
              console.warn('[circleApp] mirror addTask failed:', err?.message ?? err);
              return null;
            }
          },
        }));
      }
    }
  } catch (err) {
    console.warn('[circleApp] agent boot failed — showing empty launcher', err);
  }

  try {
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] loadCircles failed', err);
    circlesCache = [];
  }
  // α.3 — Schermen is the primary landing tab.  First-run seeds the
  // default Stream screen inside showScreens.
  showScreens().catch((err) => {
    console.warn('[circleApp] showScreens failed; falling back to launcher', err);
    showLauncher();
  });
}

boot();
