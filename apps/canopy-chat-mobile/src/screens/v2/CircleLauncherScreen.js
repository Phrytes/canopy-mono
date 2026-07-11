/**
 * canopy-chat-mobile v2 — circle launcher + detail screen (boards 1B / F1).
 *
 * Mobile counterpart of web's circleLauncher + circleDetail + circleApp,
 * over the same shared model ('@canopy-app/canopy-chat'). The launcher is
 * the app's default screen; the classic ChatScreen stays reachable via
 * "← chat". Opening a circle sets the active circle (F1) and shows an
 * inline scoped detail; "+ new circle" creates one via the existing
 * createGroupV2 path and refreshes.
 *
 * Data: with a `bundle` (callSkill) real circles + items + create work via
 * the shared helpers; otherwise the empty states show + create is a no-op.
 * Flagged for device verification.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, BackHandler, Modal, Alert, findNodeHandle } from 'react-native';
import { theme } from './theme.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, quickCreateCircle, setActiveCircle, normalizeCircleMembers,
  circleFilesFromListFiles,
  // P6.1 — per-kring feature-flag consumption.
  isFeatureEnabled,
  // §4 — admin's policy.view → default Chat/Scherm landing surface.
  defaultViewModeFromPolicy,
  // P6.3 — per-circle activity preview + unread badge.
  buildTilePreviews, bumpSeenAt,
  // P6.5 #342 — claim-router hook (mirror claimed tasks to my own circle).
  makeAfterClaimHook,
  // P6.8 #346 — Nearby/HIER model + label helpers (board 8C).
  buildNearbyModel,
  // P6.M7 #349 — "My things" private notes-list (board 10A).
  myThingsFromListFiles,
  // SP-13.2 — kring-scoped event stream + per-row action chips.
  buildKringStream, actionsForStreamRow,
  // SP-13.3 — per-kring bottom tabs from policy.features (v2 §1).
  buildKringTabs, DEFAULT_KRING_TAB,
  // D1 (§5A) — quickActions row: feature↔tab mapping + frequency counter.
  featureTabId, featureForTabId, createActionFrequencyStore,
  // α.1a/b — scherm recipe model + per-block materializer.
  getActiveRecipe, materializeRecipe, materializeBlock,
  // α.1d.3 — recipe-editor mutation helpers.
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
  // α.2 — user-owned cross-kring screens + α.3 picker.
  createUserScreenStore, addScreen as addUserScreen,
  renameScreen as renameUserScreen, removeScreen as removeUserScreen,
  setActiveScreen, updateScreen, materializeScreen,
  // δ.2 — per-message delivery state for optimistic kring chat sends.
  createDeliveryStateMap,
  // Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out).
  kringChatMessageEvent, broadcastKringFanOut,
  // Phase 3 — the shared circle label→candidate lookup (base items + app-qualified live fetch).
  makeCircleLookup,
  // Composer parity — the classic shell's slash-command suggest, shared so mobile renders the same set.
  suggestCommands,
  // Conversational follow-up for needsForm (shared) — ask for a missing field, next message answers.
  // beginFormFollowUp/completeMultiFieldFollowUp drive the 2+-field inline form (parity with web).
  beginFollowUp, completeFollowUp, beginFormFollowUp, completeMultiFieldFollowUp,
  // Shared one-line bot reply (verb-aware Added:/Completed:) + Part D catalog scoping (drops /me etc.).
  kringReplyText, scopeCatalogToApps,
  // B (circle bot) — dispatch primitives to run an interpreted command in the kring.
  parseInput, resolveDispatch, runDispatch, scopeReadyDispatch, executeBulkDispatch,
} from '@canopy-app/canopy-chat';
// B (circle bot) — v2 free-text→LLM→command surface (shared with web). Deep-imported like the other
// v2 modules (kringChatReceiver etc.) since they're not on the canopy-chat barrel.
// S6.A — manifest-driven inline buttons on bot replies (the resurrected inline menu), shared with web.
import { embedButtonsForReply, embedsFromReply } from '../../../../canopy-chat/src/v2/replyEmbeds.js';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../../../canopy-chat/src/v2/embedChips.js';
import { buildManifestsByOrigin } from '../../core/composeManifests.js';
// D / Surface 2 — the detail ACTION BAR roster, projected from manifest.actions
// via the shared selector (web≡mobile; NOT a hand-written ⋯-menu list).
import { circleActionsMobile } from '../../../../canopy-chat/src/v2/actionProjection.js';
import { canopyChatManifest } from '../../../../canopy-chat/src/index.js';
// S6.B/C — open-screen surface + per-circle gate (shared with web).
import { isAppSurfaceEnabled } from '../../../../canopy-chat/src/v2/appFeature.js';
// B · Slice 1/4 — the capability gate + the affordance matrix (web≡mobile, shared core).
import { effectiveCapabilities, checkCapability } from '../../../../canopy-chat/src/v2/capabilityGate.js';
import { buildCapabilityMatrix } from '@canopy/app-manifest';
// S6.C — per-user surface preference (inline / screen / minimal), shared selector + the mobile store.
import { selectSurfaceButtons } from '../../../../canopy-chat/src/v2/surfacePref.js';
// "only you" vs "whole kring" — message scope (data property; the badge renders it).
import { scopeForReply } from '../../../../canopy-chat/src/v2/messageScope.js';
import { buildFindExtras } from '@canopy/kring-host/findExtras';
// S6.D — is the conversational "chat" projection LLM-enriched here? (user LLM + circle permits)
import { resolveChatAi } from '../../../../canopy-chat/src/v2/chatAi.js';
import { surfacePrefStore } from '../../core/surfacePrefStore.js';
import MultiFieldFormBubble from '../../rn/MultiFieldFormBubble.js';   // 2+-field inline form (parity with web)
import { createCircleDispatch, addressesBot } from '../../../../canopy-chat/src/v2/circleDispatch.js';
// OBJ-2 membership — reuse the classic RN join wizard + the camera scanner + the shared invite glue.
import JoinGroupWizardModal from '../../../../canopy-chat/src/rn/wizards/joinGroupWizardModal.js';
import QrScannerModal from '../../rn/QrScannerModal.js';
import { QrCodeView } from '@canopy/react-native/qr/view';
import { buildCircleInviteUri } from '../../../../canopy-chat/src/v2/circleInvite.js';
import { feedHouseholdRoster } from '../../../../canopy-chat/src/v2/householdRosterPairing.js';
// Conversation memory — recent kring turns woven into the bot's interpret context.
import { recentKringTurns } from '../../../../canopy-chat/src/v2/kringMemory.js';
import { createTokenGate } from '../../../../canopy-chat/src/v2/tokenGate.js';
import { makeCircleRetriever } from '../../../../canopy-chat/src/v2/circleRetriever.js';
import { createMemoryBackend } from '@canopy/pseudo-pod';
import { createAsBackend } from '@canopy/react-native/pseudo-pod-adapter';
import { buildCircleEmbedProviders } from '../../../../canopy-chat/src/v2/circleEmbedProviders.js';
import { resolveCircleEmbedder } from '../../../../canopy-chat/src/v2/embedPicker.js';
import { circleGateRules } from '../../../../canopy-chat/src/v2/circleGate.js';
import { interpretToCommand } from '../../../../canopy-chat/src/v2/interpretCommand.js';
import { scopeStoopCallSkill } from '../../../../canopy-chat/src/v2/circleStoopScope.js';
// Sealed media (2026-07-11): the per-circle media composition is SHARED src/ (platform-neutral,
// no DOM). Mobile reuses it verbatim — same seal path as web's stoop noticeboard — so a prikbord
// image seals per-circle instead of being refused. Do NOT reimplement sealing in the shell.
import { createCircleMediaComposition, makeDevMediaBucket } from '../../../../canopy-chat/src/v2/circleMediaGateway.js';
import { getCircleSealStrategy, seedCircleRosterFor, getCirclePodFetch, getCircleActorWebId } from '../../core/circlePods.js';
// M6 — the feedback bot rides the SHARED mount (web uses the same one). tryHandle routes /feedback +
// /feedback-stop + free text while active, before the circle bot; bubbles render via appendKringMessage.
import { createFeedbackMount } from '../../../../canopy-chat/src/feedback/feedbackMount.js';
import { buildCircleLlmProviders } from '../../../../canopy-chat/src/v2/circleLlmProviders.js';
import { createClarifyingDispatch } from '../../../../canopy-chat/src/v2/clarifyingDispatch.js';
// Q27 — the shared confirm gate at the dispatch waist (mobile presenter: Alert.alert, destructive style).
import { runConfirmGate, alertConfirmPresenter } from '../../core/confirmDispatch.js';
import { createUserLlmDefaultStore, asyncStorageUserLlmIo } from '../../../../canopy-chat/src/v2/userLlmDefault.js';
import { buildUserLlmRuntime, validateUserLlmConfig } from '../../../../canopy-chat/src/v2/userLlmRuntime.js';
import { formatNearbyLabel } from '../../core/nearbyLabel.js';
import { t, lang } from '../../core/localisation.js';
import {
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
  // Objective D — session → podWriter so the availability pref publishes.
  sessionToPodWriterRN,
  // P6.2 — persisted multi-admin proposals.
  makeProposalStoreRN,
  // α.1e — scherm recipe book persistence.
  makeKringRecipeStoreRN,
  // α.3 — per-user screens persistence.
  makeUserScreenStoreRN,
  // β.5 — per-user pin-to-top persistence.
  makeCirclePinStoreRN,
  // γ.2 — per-circle rules persistence + version capture (was inline
  // AsyncStorage at the rules entry points up to β).
  makeCircleRulesStoreRN,
} from '../../core/circleStoresRN.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render).
import { makeScreenBlocksCacheRN } from '../../core/screenBlocksCacheStorageRN.js';
import CircleSettingsScreen from './CircleSettingsScreen.js';
import CircleOverrideScreen from './CircleOverrideScreen.js';
// B · Slice 3 — the mobile list-screen surface (web≡mobile).
import CircleListScreen from './CircleListScreen.js';
// D-mig-mobile-1b — list-screen config is now SOURCED from the projected manifest
// section (shared `sectionForScreen`), mirroring web 1b. The old hardcoded
// list-screen literal is retired: each screenId resolves to `{section, appOrigin}`
// over the composed manifests, and the section's dataSource/labelField/categoryField/
// searchFields drive the fetch + render — no per-shell duplication (invariant #1/#3).
import { sectionForScreen } from '../../../../canopy-chat/src/v2/pageProjection.js';
// Q15/Q17 — generic screen drill-down (row → detail with selection context),
// the mobile twin of web's openCircleScreenPanel wiring.  The drill/selection/
// fetch logic is SHARED (src/v2/screenDrilldown.js) — the portable core module
// only binds renderMobile + the {circleId, ...selection} host-context shape.
import {
  screenPanelContext, drilldownForScreen, selectionContextFor,
  fetchScreenItems, itemsFromReply, recordFromReply,
} from '../../core/screenPanelDrilldown.js';
import CircleRecordScreen from './CircleRecordScreen.js';
import CircleAvailabilityScreen from './CircleAvailabilityScreen.js';
import CircleStreamScreen from './CircleStreamScreen.js';
import CircleViewAsScreen from './CircleViewAsScreen.js';
import CircleAdvisorScreen from './CircleAdvisorScreen.js';
import CircleHopScreen from './CircleHopScreen.js';
import CircleSkillEditorScreen from './CircleSkillEditorScreen.js';
import CircleFolioScreen from './CircleFolioScreen.js';
import CircleRulesScreen from './CircleRulesScreen.js';
import CircleRulesConsentScreen from './CircleRulesConsentScreen.js';
import CircleTabBar from './CircleTabBar.js';
import CircleScreenView from './CircleScreenView.js';
import CircleRecipeEditorScreen from './CircleRecipeEditorScreen.js';
import CircleScreensPickerScreen from './CircleScreensPickerScreen.js';
import ContactsScreen from './ContactsScreen.js';
import ContactThreadScreen from './ContactThreadScreen.js';
import FeedbackThreadScreen from './FeedbackThreadScreen.js';
import { createFeedbackBotStore } from '../../../../canopy-chat/src/v2/feedbackBots.js';
// objective L · Phase 2 — the Contacten roster feeds CircleShareScreen's out-of-circle recipient picker.
import { listContacts, mergeContacts, stoopContactToRow } from '../../../../canopy-chat/src/v2/contactsSource.js';
import CircleNoticeboard from './CircleNoticeboard.js';
import CircleListsScreen from './CircleListsScreen.js';   // cluster K · K2 — composable lists (web≡mobile)
import CircleShareScreen from './CircleShareScreen.js';   // objective L — cross-circle share UI (web≡mobile)
import CircleProfileScreen from './CircleProfileScreen.js';
import CircleAdminPanelScreen from './CircleAdminPanelScreen.js';
import CircleMyDataScreen from './CircleMyDataScreen.js';
import SharedWithMeScreen from './SharedWithMeScreen.js';   // SILENT out-of-circle delivery — personal "shared with me" inbox (web≡mobile)

// B (circle bot) — host LLM route for NL→command in the kring. Mirrors web's VITE_CIRCLE_LLM_BASEURL
// + the feedback mobile EXPO_PUBLIC_FEEDBACK_LLM_BASEURL pattern. Unset → no provider → the LLM branch
// stays inert (slash commands + plain kring chat still work).
const CIRCLE_LLM_BASEURL = process.env.EXPO_PUBLIC_CIRCLE_LLM_BASEURL || null;
const CIRCLE_LLM_MODEL   = process.env.EXPO_PUBLIC_CIRCLE_LLM_MODEL || undefined;
// Per-call LLM timeout (web parity: VITE_CIRCLE_LLM_TIMEOUT_MS). The provider's 12s default is fine for a
// fast enclave but aborts a CPU-only local model (qwen2.5:7b warms up + answers in 60–120s) → the bot
// silently drops to "basic mode". Default generous (120s); override via env.
const CIRCLE_LLM_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_CIRCLE_LLM_TIMEOUT_MS ?? 120000) || 120000;
// F-retrieve tier-2 embeddings (web parity) — base defaults to the LLM base (the
// enclave serves /v1/chat/completions + /v1/embeddings), so semantic RAG rides the
// same trust boundary; null base → semantic inert (tier-1 lexical).
const CIRCLE_EMBED_BASEURL = process.env.EXPO_PUBLIC_CIRCLE_EMBED_BASEURL || CIRCLE_LLM_BASEURL;
const CIRCLE_EMBED_MODEL   = process.env.EXPO_PUBLIC_CIRCLE_EMBED_MODEL || undefined;
const CIRCLE_BOT_NAME    = process.env.EXPO_PUBLIC_CIRCLE_BOT_NAME || 'assistant';
// M6 — feedback bot's LLM route (cleans/anonymizes participant input). Unset → in-memory demo mode.
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
// Default circle posture (off|local|cloud|user); 'user' = each member's personal default decides.
const CIRCLE_LLM_POLICY  = process.env.EXPO_PUBLIC_CIRCLE_LLM_POLICY || 'user';
// Scope the LLM's tool list to these app origins (comma-list, e.g. "household,tasks"). Unset → the bot
// offers ALL circle apps' ops (~105 tools) — a big, slow prompt. Narrowing to the relevant apps cuts the
// tool count dramatically (household alone ≈ 16), so the per-turn prompt is far smaller + faster.
const CIRCLE_LLM_APPS = (process.env.EXPO_PUBLIC_CIRCLE_LLM_APPS || '').split(',').map((s) => s.trim()).filter(Boolean);

// F-retrieve persistence (web parity): one app-level StorageBackend for the
// circle-bot RAG vector index, scoped per-circle inside the retriever to
// private/state/search-index/circle-rag/<circleId>/ (never sharing/ — invariant
// #7). Same @canopy/pseudo-pod substrate the circle pods run on (see
// src/core/circlePods.js). Objective L (2026-07-08): AsyncStorage-PERSISTENT on
// device (createAsBackend over the RN AsyncStorage) so embedded vectors survive a
// restart instead of re-embedding — mirrors web's IndexedDB wiring; falls back to
// in-memory when AsyncStorage is unusable (tests use a Map-backed stub, so this
// path is exercised there). The remaining path — a real signed-in Solid pod —
// stays the live-pod tail.
const circleSearchVectorStore = (AsyncStorage && typeof AsyncStorage.getItem === 'function')
  ? createAsBackend({ AsyncStorage, scope: 'cc-circle-rag' })
  : createMemoryBackend();

// Sealed media (2026-07-11) — mirror web circleApp.js: ONE DEV bucket per app session
// (in-memory; the real S3/R2 swap point is recorded in circleMediaGateway.js), and the
// per-circle sealed-media composition cached so the session ACL's grants persist across
// re-opens. A p0/p1 circle (no seal strategy) composes to `null` → sealed-only: the wrapper
// refuses attachments and the 📎 affordance stays hidden (NO unsealed fallback). This is the
// SHARED composition both platforms use — reused, not reimplemented in the shell.
const circleMediaBucket = makeDevMediaBucket();
const circleMediaCompositions = new Map();   // circleId → Promise<composition|null>
function getCircleMediaComposition(circleId, policy) {
  if (!circleId) return Promise.resolve(null);
  if (!circleMediaCompositions.has(circleId)) {
    circleMediaCompositions.set(circleId, createCircleMediaComposition({
      circleId,
      getSealStrategy: () => getCircleSealStrategy(circleId, policy),
      localActor: getCircleActorWebId() || 'me',
      bucket: circleMediaBucket,
    }).catch(() => null));
  }
  return circleMediaCompositions.get(circleId);
}

// D1 (§5A) — per-circle action-frequency counter behind the quickActions
// row.  Module singleton (shared across kring opens), hydrated once from
// AsyncStorage and persisting its snapshot on every bump.  In-memory reads
// work before hydration completes (just yield the default feature order).
const ACTION_FREQ_KEY = 'cc.actionFrequency';
const actionFrequency = createActionFrequencyStore({}, {
  onChange: (snap) => { AsyncStorage.setItem(ACTION_FREQ_KEY, JSON.stringify(snap)).catch(() => {}); },
});
AsyncStorage.getItem(ACTION_FREQ_KEY).then((raw) => {
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    for (const [cid, counts] of Object.entries(snap ?? {})) {
      for (const [k, v] of Object.entries(counts ?? {})) {
        if (typeof v === 'number' && v > 0) actionFrequency.bump(cid, k, v);
      }
    }
  } catch { /* corrupt snapshot — ignore */ }
}).catch(() => {});

// D1 (§5A) — in-memory fallback recipe (just the Veel-gebruikt row) for a
// kring with no authored scherm.  Never persisted.
const DEFAULT_SCHERM_RECIPE = Object.freeze({
  // #16 — quick-actions + the noticeboard (buurt prikbord via stoop listOpen), so a
  // scherm-landing circle surfaces the open posts even with the chat tab hidden.
  id: '__default__', name: '', blocks: [
    { id: 'qa-default', type: 'quickActions', config: { limit: 4 } },
    { id: 'nb-default', type: 'noticeboard',  config: { limit: 8 } },
  ],
});

// Wrap a top-level surface (Kringen / Stroom / Mij) with the bottom tab bar.
function WithTabBar({ active, onSelect, children }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <CircleTabBar active={active} onSelect={onSelect} />
    </View>
  );
}

export default function CircleLauncherScreen({
  bundle,
  // cluster J — the OidcSessionRN ref (App.js:187), needed to activate the feedback verify pods.
  sessionRef = null,
  // cluster J — podAuth (lifted from the hidden ChatScreen) so the "Me" screen can drive pod sign-in.
  podAuth = null,
  eventLog,
  kringRecipePendingStore = null,
  // γ-next.rules — per-kring pending-rules cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; rules editor reads on mount +
  // clears after the γ.4 resolver applies / discards.
  kringRulesPendingStore = null,
  // γ-next.policy — per-kring pending-policy cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; settings editor reads on mount +
  // clears after the γ.4 resolver applies / discards.  Completes the
  // γ-next trio (recipe / rules / policy).
  kringPolicyPendingStore = null,
}) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // M3 — sub-view within the launcher: 'list' | 'availability' | 'detail'
  // | 'settings' | 'override'.  `selected` carries the active circle for
  // detail/settings/override.
  // α.3 — boot lands on the Schermen tab (Q6 primary).  Was 'list' (= Kringen).
  const [view, setView] = useState('screens');
  // The member's saved assistant endpoint config (settings → My data). Persisted to AsyncStorage;
  // CircleDetail re-reads it on mount, so a save applies the next time a circle opens.
  const [userLlmCfg, setUserLlmCfg] = useState({});
  useEffect(() => {
    let alive = true;
    createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get().then((v) => { if (alive) setUserLlmCfg(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const onSaveUserLlm = useCallback(async (cfg) => {
    const err = validateUserLlmConfig(cfg);
    if (err) return err;                       // confidential-route guard → inline message
    const saved = await createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).set(cfg).catch(() => cfg);
    setUserLlmCfg(saved);
    return null;
  }, []);
  // P5 — the contact (bot/peer) whose DM thread is open under the Contacten tab.
  const [contactThread, setContactThread] = useState(null);
  // cluster J — persisted registry of added feedback bots (AsyncStorage), shared with the Contacten roster
  // + the dedicated feedback thread. Created once.
  const feedbackStoreRef = useRef(null);
  if (!feedbackStoreRef.current) feedbackStoreRef.current = createFeedbackBotStore(AsyncStorage);
  const feedbackStore = feedbackStoreRef.current;
  const [viewAsPolicy, setViewAsPolicy] = useState('pairwise');
  const [viewAsMembers, setViewAsMembers] = useState([]);
  const [folioFiles, setFolioFiles] = useState([]);
  // B · Slice 4 — the acting member's capability matrix for the folio file
  // browser. Gates the file-OPEN row action (get × file) the SAME way the list
  // surface gates its row buttons. Empty until built ⇒ 'show' ⇒ unchanged.
  const [folioCapMatrix, setFolioCapMatrix] = useState([]);
  const [skillDraft, setSkillDraft] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [rulesPreview, setRulesPreview] = useState(null);
  // γ-next.rules — pending incoming rules doc (from peer broadcast).
  // Loaded when the rules screen opens; cleared after the γ.4 resolver
  // applies or discards.
  const [incomingRules, setIncomingRules] = useState(null);
  // γ-next.policy — pending incoming policy doc (from peer broadcast).
  // Loaded when the settings screen opens; cleared after the γ.4
  // resolver applies or discards.
  const [incomingPolicy, setIncomingPolicy] = useState(null);
  // α.1d.3 — recipe editor state (lives in the parent so book + mode
  // survive the BOOK ↔ RECIPE round-trip).  Callbacks land below
  // after recipeStore is declared.
  const [recipeBook, setRecipeBook] = useState({ recipes: [], activeId: null });
  const [recipeEditorMode, setRecipeEditorMode] = useState('book');
  const [recipeEditingId, setRecipeEditingId] = useState(null);
  // γ-next.recipe — pending incoming recipe (from peer broadcast).
  // Loaded when the recipe screen opens; cleared after γ.3 resolver
  // applies or discards.
  const [incomingRecipe, setIncomingRecipe] = useState(null);
  // α.3 — Screens-tab state.  Two sub-modes: 'picker' (CRUD list) +
  // 'view' (render the materialized active screen).  Book + blocks
  // live here so they survive sub-mode switches without refetching.
  const [screensBook, setScreensBook] = useState({ screens: [], activeId: null });
  const [screensSubMode, setScreensSubMode] = useState('picker');
  const [viewingScreenId, setViewingScreenId] = useState(null);
  const [screenViewBlocks, setScreenViewBlocks] = useState(null);
  // δ.1 — true while a fresh materialize runs after a cache-hit render.
  // Drives the subtle refresh pip in CircleScreenView.
  const [screenViewRefreshing, setScreenViewRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // OBJ-2 — join a circle: scan an invite QR → run the shared join wizard. Invite modal: show this
  // circle's membership QR. Both reuse the classic membership core; nothing new below the surface.
  const [joinScanOpen, setJoinScanOpen] = useState(false);
  const [joinArgs, setJoinArgs] = useState(null);     // {invite} → JoinGroupWizardModal runs
  const [inviteFor, setInviteFor] = useState(null);   // {circleId, uri, error} → invite-QR modal
  // P6.1 — selected circle's policy (loaded when `selected` changes); used
  // to gate detail action buttons on the Functies axis (board 4A).
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [chatAi, setChatAi] = useState({ enriched: false, reason: 'no-provider' });   // S6.D — chat LLM enrichment for My-data
  // P6.3 — kring tile activity preview ({subtitle, ts, unread} per circle)
  // + seenAt persistence (the per-circle "last-open" marker that drives the
  // unread badge).  Loaded on mount; bumped on openCircle.
  const [seenAt,   setSeenAt]   = useState({});
  const [previews, setPreviews] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('cc.circleSeenAt');
        if (alive && raw) setSeenAt(JSON.parse(raw) || {});
      } catch { /* fresh */ }
    })();
    return () => { alive = false; };
  }, []);
  // Recompute the previews map whenever events / circles / seenAt change.
  useEffect(() => {
    const events = eventLog?.query ? eventLog.query({ excludeMuted: true }) : [];
    setPreviews(buildTilePreviews({ events, circles, seenAt }));
  }, [eventLog, circles, seenAt]);
  // P6.2 #341 — per-circle voorstellen badge.  Populated lazily after
  // circles load; refresh after a settings save (CircleSettingsScreen
  // calls back through onPoll once it persists a new proposal).
  const [proposalCounts, setProposalCounts] = useState({});
  // P6.M7 #349 — Mijn dingen state lives here so the screen can render
  // synchronously when entered; `myThingsFiles` is loaded via listFiles.
  const [myThingsFiles, setMyThingsFiles] = useState([]);
  // P6.M8 #350 — raw Folio list result for share-toggle re-projection.
  const [rawFolioFiles, setRawFolioFiles] = useState(null);

  // P6.1 — refresh the selected circle's policy whenever `selected` changes,
  // so CircleDetail can gate its feature-bound buttons (houseRules,
  // memberDirectory).  Falls back to null on read failure → the helper
  // applies feature defaults.
  // Read the active circle's policy from the store into `selectedPolicy` (the prop CircleDetail's
  // gate + tabs + catalog react to). Extracted so an in-place settings save can re-run it — otherwise
  // CircleDetail keeps the policy it loaded on open and a newly-(dis)abled app stays (un)gated until
  // the circle is fully re-opened (device-verify #80, 2026-07-02).
  const reloadSelectedPolicy = useCallback(async () => {
    if (!selected?.id) { setSelectedPolicy(null); return; }
    let p = null;
    try { p = await policyStore.get(selected.id); } catch { /* defaults */ }
    setSelectedPolicy(p);
  }, [selected, policyStore]);
  useEffect(() => {
    if (!selected?.id) { setSelectedPolicy(null); return; }
    let alive = true;
    (async () => {
      let p = null;
      try { p = await policyStore.get(selected.id); } catch { /* defaults */ }
      if (alive) setSelectedPolicy(p);
    })();
    return () => { alive = false; };
  }, [selected, policyStore]);

  // S6.D — is the conversational "chat" projection LLM-enriched in the active circle?
  // (the circle's policy.llmTool + the member's loaded LLM + a configured provider).
  useEffect(() => {
    let alive = true;
    (async () => {
      let userLlm = { mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' };
      try { const v = await createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get(); if (v) userLlm = v; } catch { /* default */ }
      const r = resolveChatAi({
        circleLlmTool: selectedPolicy?.llmTool ?? CIRCLE_LLM_POLICY,
        userLlmMode: userLlm?.mode,
        hasProvider: !!CIRCLE_LLM_BASEURL,
      });
      if (alive) setChatAi(r);
    })();
    return () => { alive = false; };
  }, [selectedPolicy]);

  // 5.9c — passive "Nearby N device(s)" signal from MdnsTransport.  When the
  // bundle exposes mdns we mirror its connectionCount into state, subscribed
  // to peer-discovered + peer-disconnected so the row updates as peers come
  // and go.  When bundle.mdns is null (vitest, iOS, Expo Go, Wi-Fi off) the
  // row hides via the `bundle?.mdns` gate at render time.
  const [nearbyCount, setNearbyCount] = useState(0);
  useEffect(() => {
    const mdns = bundle?.mdns;
    if (!mdns) return;
    const sync = () => {
      const n = mdns.connectionCount;
      setNearbyCount(typeof n === 'number' ? n : 0);
    };
    sync();
    mdns.on?.('peer-discovered',   sync);
    mdns.on?.('peer-disconnected', sync);
    return () => {
      mdns.off?.('peer-discovered',   sync);
      mdns.off?.('peer-disconnected', sync);
    };
  }, [bundle]);

  // M3 — AsyncStorage-backed circle stores (keys match web's localStorage
  // convention).  Created once; the sub-screens load/save through them.
  const policyStore       = useMemo(() => makeCirclePolicyStoreRN(AsyncStorage), []);
  const overrideStore     = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  // Objective D — mirror the pref to the user's pod so other agents read it.
  // getPodWriter is a thunk: null while unsigned (→ local-only), a live
  // writer once the Solid session (sessionRef) is authenticated.
  const availabilityStore = useMemo(() => makeAvailabilityStoreRN(AsyncStorage, {
    getPodWriter: () => sessionToPodWriterRN(sessionRef?.current ?? null),
  }), []);
  // SILENT out-of-circle delivery — the per-user "shared with me" inbox. The store is instantiated ON THE
  // BUNDLE (agentBundle.js) so the ChatScreen receive handler + this launcher share ONE instance; here we just
  // LOAD its list when the Mij sub-view opens (web≡mobile: mirrors web's `showSharedWithMe` reading the store).
  const sharedWithMeStore = bundle?.sharedWithMeStore ?? null;
  const [sharedWithMeList, setSharedWithMeList] = useState([]);
  useEffect(() => {
    if (view !== 'sharedWithMe' || !sharedWithMeStore) return;
    let alive = true;
    (async () => {
      let list = [];
      try { list = await sharedWithMeStore.list(); } catch { list = []; }
      if (alive) setSharedWithMeList(list);
    })();
    return () => { alive = false; };
  }, [view, sharedWithMeStore]);
  // B · Slice 4 — build the folio capability matrix from the selected circle's
  // policy + this member's opt-outs (same inputs the list surface uses). Feeds
  // CircleFolioScreen so its file-OPEN row action greys/hides per the gate.
  useEffect(() => {
    if (!selected?.id) { setFolioCapMatrix([]); return; }
    let alive = true;
    (async () => {
      let matrix = [];
      try {
        const sources = [...new Set(Object.values(buildManifestsByOrigin()))].map((manifest) => ({ manifest }));
        const ovr = await overrideStore.get(selected.id);
        matrix = buildCapabilityMatrix(sources, {
          enabledApps: Array.isArray(selectedPolicy?.apps) && selectedPolicy.apps.length ? selectedPolicy.apps : null,
          template: selectedPolicy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
        });
      } catch { /* best-effort — empty ⇒ show */ }
      if (alive) setFolioCapMatrix(matrix);
    })();
    return () => { alive = false; };
  }, [selected, selectedPolicy, overrideStore]);
  // P6.2 — multi-admin proposal store.  Settings consults this to persist
  // pending consensus proposals + commit on unanimous approval.
  const proposalStore     = useMemo(() => makeProposalStoreRN(AsyncStorage), []);
  // α.1e — per-kring scherm recipe book (multi-recipe; one marked active).
  const recipeStore       = useMemo(() => makeKringRecipeStoreRN(AsyncStorage), []);
  // α.3 — per-user screens store.  One book per user.
  const userScreenStore   = useMemo(() => makeUserScreenStoreRN(AsyncStorage), []);
  // δ.1 — per-screen materialized-blocks cache (cache-first render +
  // background refresh).  Instantiated inline rather than threaded
  // through App.js as a ref because this cache is purely a UI optimisation
  // owned by the Schermen tab; no peer-receiver writes to it from outside.
  const screenBlocksCache = useMemo(() => makeScreenBlocksCacheRN(AsyncStorage), []);
  // β.5 — per-user "pin to top" store + cached maps.  Pin = float a tile
  // to the top of its kind section; mute = per-kring `chatOff` override
  // already exposed via the override store (no new substrate).  Menu =
  // `menuCircle` is the circle whose context menu is open (null when
  // closed).
  const pinStore          = useMemo(() => makeCirclePinStoreRN(AsyncStorage), []);
  // γ.2 — per-circle rules store (replaces inline AsyncStorage in the
  // rules screen handlers).  Snapshots every save into a versions slot.
  const rulesStore        = useMemo(() => makeCircleRulesStoreRN(AsyncStorage), []);
  const [pinnedMap, setPinnedMap] = useState({});
  const [mutedMap,  setMutedMap]  = useState({});
  const [menuCircle, setMenuCircle] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const m = await pinStore.get(); if (alive) setPinnedMap(m); }
      catch { /* keep {} */ }
    })();
    return () => { alive = false; };
  }, [pinStore]);
  // Refresh the muted-map whenever the circle list changes; reads
  // each circle's override and surfaces chatOff===true as "muted".
  const refreshMutedMap = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const o = await overrideStore.get(c.id);
        if (o?.chatOff) next[c.id] = true;
      } catch { /* skip */ }
    }
    setMutedMap(next);
  }, [circles, overrideStore]);
  useEffect(() => { refreshMutedMap(); }, [refreshMutedMap]);
  // α.1d.3 — recipe-editor helpers (defined here so recipeStore is in scope).
  const refreshRecipeBook = useCallback(async (cid) => {
    if (!cid) return;
    try { setRecipeBook(await recipeStore.get(cid)); }
    catch { setRecipeBook({ recipes: [], activeId: null }); }
  }, [recipeStore]);
  const applyRecipeMutation = useCallback(async (cid, mutator) => {
    if (!cid) return;
    let nextBook = null;
    try {
      nextBook = await recipeStore.update(cid, mutator);
      setRecipeBook(nextBook);
    } catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    // γ-next.recipe — fan the just-updated active recipe out to peers.
    // Fire-and-forget; per-peer errors land in result.errors which we
    // log.  No-op when callSkill / no agent / no active recipe.
    if (!nextBook || typeof bundle?.callSkill !== 'function') return;
    const active = nextBook.recipes?.find?.((r) => r.id === nextBook.activeId);
    if (!active) return;
    const msgId = `kring-recipe-${cid}-${Date.now()}`;
    const ts    = Date.now();
    bundle.callSkill('stoop', 'broadcastKringRecipe', {
      groupId: cid, recipe: active, msgId, ts,
    }).then((r) => {
      if (r?.error) console.warn('[kring-recipe] fan-out skipped:', r.error);
    }).catch((err) => {
      console.warn('[kring-recipe] fan-out failed:', err?.message ?? err);
    });
  }, [recipeStore, bundle]);

  // γ-next.recipe — pull cached pending recipe whenever the recipe
  // editor view opens for a selected circle.  γ.3's resolver runs
  // automatically from inside the editor when incomingRecipe is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'recipes' || !selected?.id || !kringRecipePendingStore) {
      setIncomingRecipe(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRecipePendingStore.get(selected.id);
        if (alive) setIncomingRecipe(cached ?? null);
      } catch { if (alive) setIncomingRecipe(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRecipePendingStore]);

  // γ-next.recipe — clear the cached pending recipe after the γ.3
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRecipe = useCallback(async () => {
    setIncomingRecipe(null);
    if (selected?.id && kringRecipePendingStore) {
      try { await kringRecipePendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRecipePendingStore]);

  // γ-next.rules — pull cached pending rules doc whenever the rules
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingRules is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'rules' || !selected?.id || !kringRulesPendingStore) {
      setIncomingRules(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRulesPendingStore.get(selected.id);
        if (alive) setIncomingRules(cached ?? null);
      } catch { if (alive) setIncomingRules(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRulesPendingStore]);

  // γ-next.rules — clear the cached pending rules after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRules = useCallback(async () => {
    setIncomingRules(null);
    if (selected?.id && kringRulesPendingStore) {
      try { await kringRulesPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRulesPendingStore]);

  // γ-next.policy — pull cached pending policy doc whenever the settings
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingPolicy is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'settings' || !selected?.id || !kringPolicyPendingStore) {
      setIncomingPolicy(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringPolicyPendingStore.get(selected.id);
        if (alive) setIncomingPolicy(cached ?? null);
      } catch { if (alive) setIncomingPolicy(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringPolicyPendingStore]);

  // γ-next.policy — clear the cached pending policy after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingPolicy = useCallback(async () => {
    setIncomingPolicy(null);
    if (selected?.id && kringPolicyPendingStore) {
      try { await kringPolicyPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringPolicyPendingStore]);

  // α.3 — Screens helpers.
  const refreshScreensBook = useCallback(async () => {
    let book;
    try { book = await userScreenStore.get(); }
    catch { book = { screens: [], activeId: null }; }
    // First-run seed: three default screens (Stream, My things,
    // My calendar) so the Schermen tab is immediately useful.  Once
    // any screen exists we never re-seed.
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
    setScreensBook(book);
  }, [userScreenStore]);
  const applyScreenMutation = useCallback(async (mutator) => {
    try { setScreensBook(await userScreenStore.update(mutator)); }
    catch (err) { console.warn('[screens] mutation failed:', err?.message ?? err); }
  }, [userScreenStore]);
  // Refresh + materialize whenever we land on the screens view.
  useEffect(() => {
    if (view !== 'screens') return;
    refreshScreensBook();
  }, [view, refreshScreensBook]);
  useEffect(() => {
    if (view !== 'screens' || screensSubMode !== 'view' || !viewingScreenId) {
      setScreenViewBlocks(null);
      setScreenViewRefreshing(false);
      return;
    }
    const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
    if (!screen) { setScreenViewBlocks([]); setScreenViewRefreshing(false); return; }
    // δ.1 — cache-first render: paint the last materialized payload
    // immediately so the press feels instant, then materialize fresh
    // in the background.  On a cache miss we keep the existing null →
    // Loading… → fresh flow.  `alive` doubles as the race-token: if
    // the user navigates away while materialize is in flight, drop
    // the result.
    let alive = true;
    (async () => {
      // Cache-first read.  Any failure → fall through to the cold path.
      let cached = null;
      try { cached = await screenBlocksCache.get(viewingScreenId); }
      catch { /* ignore */ }
      if (!alive) return;
      if (Array.isArray(cached)) {
        setScreenViewBlocks(cached);
        setScreenViewRefreshing(true);
      } else {
        setScreenViewBlocks(null);
        setScreenViewRefreshing(false);
      }
      try {
        const blocks = await materializeScreen({
          screen,
          hostOps: { callSkill, eventLog, circles, fetchImpl: getCirclePodFetch() || undefined },
        });
        if (!alive) return;
        setScreenViewBlocks(blocks);
        setScreenViewRefreshing(false);
        // Best-effort: write the fresh blocks back so the next open is
        // also instant.  Quota / serialisation failures are silent.
        screenBlocksCache.set(viewingScreenId, blocks).catch(() => { /* ignore */ });
      } catch (err) {
        console.warn('[screens] materialize failed:', err?.message ?? err);
        if (!alive) return;
        // Keep the cached payload visible on materialize failure rather
        // than blanking the screen; just stop the pip.  If there was no
        // cache to begin with, fall back to the empty array.
        setScreenViewRefreshing(false);
        if (!Array.isArray(cached)) setScreenViewBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [view, screensSubMode, viewingScreenId, screensBook, callSkill, eventLog, circles, screenBlocksCache]);

  const callSkill = useMemo(
    // Pass a catalog getter so the resolver skips origins that don't declare the op
    // (no probe-storm). Lazy → read at dispatch time, after `catalog` is defined below.
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill, undefined, () => catalog) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, circlesStore: bundle?.agent?.circlesStore })
        : {};
      const _l = await loadCircles(sources);
      setCircles(_l);
      return _l.length;
    } catch {
      setCircles([]);
      return 0;
    } finally {
      setLoading(false);
    }
  }, [callSkill, bundle]);

  // objective L · Phase 2 — the unified Contacten roster (PeerGraph bots/peers + stoop ContactBook people),
  // via the SAME shared helpers ContactsScreen uses. Fed to CircleShareScreen for the out-of-circle recipient
  // picker. Loaded lazily when the share view opens (below); best-effort, never blocks the launcher.
  const [shareContacts, setShareContacts] = useState([]);
  const loadShareContacts = useCallback(async () => {
    try {
      const [peerRows, stoopRes] = await Promise.all([
        listContacts(bundle?.peerGraph ?? null).catch(() => []),
        (typeof bundle?.callSkill === 'function' ? bundle.callSkill('stoop', 'listContacts', {}) : Promise.resolve(null)).catch(() => null),
      ]);
      const stoopRows = (Array.isArray(stoopRes?.contacts) ? stoopRes.contacts : []).map(stoopContactToRow).filter(Boolean);
      setShareContacts(mergeContacts(peerRows, stoopRows));
    } catch { setShareContacts([]); }
  }, [bundle]);

  // The stoop store hydrates from AsyncStorage a beat AFTER the agent bundle is
  // ready, so the first load can race ahead of it and return 0 circles (the
  // persisted ones look "lost" until the next manual reload). Retry a few times
  // while empty so saved circles surface on their own. Bounded so a genuinely
  // empty account doesn't spin; any real load (≥1 circle) stops it immediately.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      const n = await load();
      if (!cancelled && n === 0 && callSkill && (tries += 1) < 5) {
        setTimeout(() => { if (!cancelled) tick(); }, 1200);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [load, callSkill]);

  // P6.2 #341 — refresh per-circle pending proposal counts whenever the
  // circle list changes.  countPending is async per circle; we tolerate
  // partial failures (a single bad circle just shows no badge).
  const refreshProposals = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const n = await proposalStore.countPending(c.id);
        if (n > 0) next[c.id] = n;
      } catch { /* skip this circle */ }
    }
    setProposalCounts(next);
  }, [circles, proposalStore]);
  useEffect(() => { refreshProposals(); }, [refreshProposals]);

  // P6.5 #342 — wire the claim-router hook once the bundle is ready.
  // On claimTask, the host hook reads the per-circle override; when
  // `flowThrough.tasksToPersonal` is true the claimed task is mirrored
  // into the user's primary circle ('cc-default') tagged `via:<circleId>`
  // so the "ON YOUR LIST" section below can surface it.  Web wires the
  // same hook from circleApp.js — keep this parallel.
  useEffect(() => {
    if (typeof bundle?.agent?.setAfterClaimHook !== 'function') return;
    bundle.agent.setAfterClaimHook(makeAfterClaimHook({
      getOverride:       (id) => overrideStore.get(id),
      resolveCircleName: async (id) => circles.find((c) => c.id === id)?.name ?? null,
      addToPersonalCircle: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
        if (typeof bundle.callSkill !== 'function') return null;
        try {
          return await bundle.callSkill('tasks', 'addTask', {
            text,
            circleId:           'cc-default',
            originCircleId,
            originCircleName,
            originTaskId,
            tags:             [tag],
          });
        } catch { return null; }
      },
    }));
    // Cleanup: clear the hook on unmount so a hot-reload doesn't
    // leave a stale closure pointing at the previous circles array.
    return () => {
      try { bundle.agent.setAfterClaimHook(null); } catch { /* tolerate */ }
    };
  }, [bundle, overrideStore, circles]);

  // P6.5 #342 — "ON YOUR LIST" tasks scoped to the selected circle.
  // Read from tasks-v0 `getMyTasks` and filter to the rows tagged with
  // `via:<circleId>` (set by the claim-router); falls back to empty on
  // any read failure.  Refreshed when `selected` changes.
  const [myListTasks, setMyListTasks] = useState([]);
  useEffect(() => {
    if (!selected?.id || !callSkill) { setMyListTasks([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await callSkill('getMyTasks', {});
        const items = Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.tasks) ? res.tasks
          : Array.isArray(res) ? res : [];
        const wanted = `via:${selected.id}`;
        const filtered = items.filter((t) => Array.isArray(t?.tags) && t.tags.includes(wanted));
        if (alive) setMyListTasks(filtered);
      } catch {
        if (alive) setMyListTasks([]);
      }
    })();
    return () => { alive = false; };
  }, [selected, callSkill]);

  const openCircle = useCallback(async (c) => {
    setActiveCircle(c.id);
    // P6.3 — bump the seenAt marker so the unread badge clears on the
    // next launcher render; persist to AsyncStorage for next boot.
    setSeenAt((prev) => {
      const next = bumpSeenAt(prev, c.id);
      AsyncStorage.setItem('cc.circleSeenAt', JSON.stringify(next)).catch(() => {});
      return next;
    });
    // SP-13.1 — no chat-route fallback anymore.  Every tap-on-kring
    // opens the kring view (which will host the GESPREK tab in SP-13.2).
    setSelected(c);
    setView('detail');
    setItems([]);
    // OBJ-2 — pair this circle's members as no-pod household-sync peers (web parity). Both devices do
    // this on open → they become mutual sync peers, so writes fan out. Best-effort; never blocks open.
    feedHouseholdRoster({ agent: bundle?.agent, circleId: c.id }).catch(() => {});
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill, bundle]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); setView('list'); };

  // β.5 — context-menu handlers (long-press a tile to open).  Pin / Mute
  // are local toggles; Settings reuses the existing per-circle Settings
  // sub-screen; Leave fires /leave-group (via stoop.leaveGroup) after a
  // native Alert confirmation.
  const onPinCircle = useCallback(async (cid) => {
    try { setPinnedMap(await pinStore.toggle(cid)); }
    catch { /* tolerate */ }
  }, [pinStore]);

  const onMuteCircle = useCallback(async (cid) => {
    try {
      const cur = await overrideStore.get(cid);
      await overrideStore.update(cid, { chatOff: !cur.chatOff });
    } catch { /* tolerate */ }
    refreshMutedMap();
  }, [overrideStore, refreshMutedMap]);

  const onLeaveCircle = useCallback((cid, circle) => {
    const name = circle?.name ?? cid;
    Alert.alert(
      t('circle.tile.menu.leave'),
      t('circle.tile.menu.leave_confirm', { name }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('circle.tile.menu.leave'),
          style: 'destructive',
          onPress: async () => {
            if (typeof bundle?.callSkill === 'function') {
              try {
                await bundle.callSkill('stoop', 'leaveGroup', { groupId: cid });
              } catch (err) {
                console.warn('[circleLauncher] leaveGroup failed:', err?.message ?? err);
              }
            }
            // Reload circles + drop any pin entry.
            try {
              const cur = await pinStore.get();
              if (cur[cid]) setPinnedMap(await pinStore.toggle(cid));
            } catch { /* tolerate */ }
            load();
          },
        },
      ],
    );
  }, [bundle, pinStore, load]);

  // β.5 — long-press on a tile opens the modal menu.
  const openTileMenu = useCallback((circle) => {
    setMenuCircle(circle);
  }, []);
  const closeTileMenu = useCallback(() => setMenuCircle(null), []);

  // Android back-gesture / hardware back button — pop the current sub-view
  // instead of exiting the app.  Mirrors each screen's existing onBack
  // semantics (the in-screen back button still works the same way).
  // Returning `true` consumes the event; `false` lets the system handle
  // it (exits the app — only when we're at the launcher root + nothing
  // inline to cancel).
  useEffect(() => {
    const handler = () => {
      // β.5 — tile context menu open → close it.  Highest priority since
      // any subsequent state-based pop would feel wrong while the modal
      // is on top.
      if (menuCircle) { setMenuCircle(null); return true; }
      // Inline cancel: creating-circle input row.
      if (creating) { setCreating(false); setNewName(''); return true; }
      // α.3 — viewing a screen (Schermen tab "view" sub-mode) → back to
      // the picker (the screens-tab equivalent of returning from a
      // sub-view to the list).
      if (view === 'screens' && screensSubMode === 'view') {
        setScreensSubMode('picker'); setViewingScreenId(null); return true;
      }
      // Sub-views under a selected circle → back to detail.
      if (selected && (
        view === 'settings' || view === 'override' || view === 'viewas'
        || view === 'advisor' || view === 'skills' || view === 'folio'
        || view === 'rules' || view === 'lists'
      )) { setView('detail'); return true; }
      // Rules consent preview → back to rules editor.
      if (selected && view === 'rulesconsent') { setView('rules'); return true; }
      // Hop screen lives under the Mij tab.
      if (view === 'hop') { setView('availability'); return true; }
      // S2/S5 — Mij sub-views.
      if (view === 'mydata') { setView('profile'); return true; }
      // S3 — admin panel is a sub-view of the circle detail.
      if (selected && view === 'admin') { setView('detail'); return true; }
      // Top-level tab screens → back to launcher list.
      if (view === 'availability' || view === 'stream' || view === 'profile'
          || view === 'nearby' || view === 'mythings') {
        setView('list'); return true;
      }
      // Circle detail → close the circle (back to launcher list).
      if (selected) { closeCircle(); return true; }
      // SP-13.1 — no onBack fallback (no chat shell to fall back to);
      // at the launcher root, let the system handle (exit).
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [view, selected, creating, menuCircle, screensSubMode]);

  // Bottom tab bar (Screens / Kringen / Mij).  α.3 — Schermen is the
  // new primary; Stroom is retired (now lives as the seeded "Stream"
  // screen on the Screens tab).
  const onTab = (id) => {
    if (id === 'screens') setView('screens');
    else if (id === 'kringen') { setActiveCircle(null); setSelected(null); setView('list'); }
    else if (id === 'contacten') { setContactThread(null); setView('contacten'); }
    else if (id === 'mij') setView('profile');   // S2 — Mij is now the profile
  };

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !bundle?.callSkill) { setCreating(false); setNewName(''); return; }
    try {
      await quickCreateCircle({ callSkill: bundle.callSkill, name });
    } catch { /* surfaced by reload showing no new circle */ }
    setCreating(false);
    setNewName('');
    load();
  }, [newName, bundle, load]);

  // OBJ-2 — scanned a circle invite QR → hand it to the shared join wizard.
  const onJoinScan = useCallback((res) => {
    setJoinScanOpen(false);
    if (res && res.kind === 'invite' && res.payload) setJoinArgs({ invite: res.payload });
  }, []);
  // OBJ-2 — show THIS circle's membership QR (admin-gated by the substrate).
  const openCircleInvite = useCallback(async (circleId) => {
    let r;
    try { r = await buildCircleInviteUri({ callSkill: bundle?.callSkill, circleId, adminPeerAddr: bundle?.agent?.householdSelfAddr ?? null }); }
    catch { r = { error: 'failed' }; }
    setInviteFor({ circleId, ...(r || {}) });
  }, [bundle]);

  if (view === 'screens') {
    // α.3 — Screens primary tab.  Two sub-modes: 'picker' (CRUD list)
    // and 'view' (render the active screen's materialized blocks).
    if (screensSubMode === 'view') {
      const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
      return (
        <WithTabBar active="screens" onSelect={onTab}>
          <View style={{ flex: 1, padding: 16, backgroundColor: theme.color.paper }}>
            <Pressable
              onPress={() => { setScreensSubMode('picker'); setViewingScreenId(null); }}
              accessibilityRole="button"
              testID="screens-view-back"
            >
              <Text style={{ color: theme.color.inkSoft, fontSize: 13, marginBottom: 8 }}>
                ← {t('circle.screens.picker_title')}
              </Text>
            </Pressable>
            <Text style={{ fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink, marginBottom: 12 }}>
              {screen?.name || t('circle.screens.untitled')}
            </Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <CircleScreenView blocks={screenViewBlocks} refreshing={screenViewRefreshing} />
            </ScrollView>
          </View>
        </WithTabBar>
      );
    }
    return (
      <WithTabBar active="screens" onSelect={onTab}>
        <CircleScreensPickerScreen
          book={screensBook}
          onOpenScreen={(sid) => { setViewingScreenId(sid); setScreensSubMode('view'); }}
          onAddScreen={(name) => applyScreenMutation((cur) => {
            const next = addUserScreen(cur, name);
            const newId = next.screens[next.screens.length - 1].id;
            return updateScreen(next, newId, (s) => addBlock(s, 'noticeboard'));
          })}
          onRenameScreen={(sid, name) => applyScreenMutation((cur) => renameUserScreen(cur, sid, name))}
          onRemoveScreen={(sid) => applyScreenMutation((cur) => removeUserScreen(cur, sid))}
          onSetActive={(sid) => applyScreenMutation((cur) => setActiveScreen(cur, sid))}
        />
      </WithTabBar>
    );
  }
  // S2 — Mij = your profile (identity + skills + location); availability is a sub-view.
  if (view === 'profile') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleProfileScreen callSkill={bundle?.callSkill} onAvailability={() => setView('availability')} onMyData={() => setView('mydata')} onSharedWithMe={() => setView('sharedWithMe')} />
      </WithTabBar>
    );
  }
  // SILENT out-of-circle delivery — the personal, cross-circle "shared with me" inbox
  // (sealed copies peers pushed to this device). Sub-view of Mij; back returns to profile.
  // web ≡ mobile: renders the SAME SharedWithMeScreen over the SAME shared selector web uses.
  // `received` is loaded from the bundle's per-user shared-with-me store (the effect above);
  // `opener` is this device's own network-derived sealing opener (bundle.sharedWithMeOpener,
  // built from the encapsulated identity secret). A null opener makes a row tap a deny-safe no-op.
  if (view === 'sharedWithMe') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <SharedWithMeScreen
          received={sharedWithMeList}
          opener={bundle?.sharedWithMeOpener ?? null}
          onBack={() => setView('profile')}
        />
      </WithTabBar>
    );
  }
  // S5 — "My data": data-location + privacy + usage (read-only); sub-view of Mij.
  if (view === 'mydata') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleMyDataScreen callSkill={bundle?.callSkill} podAuth={podAuth} onBack={() => setView('profile')} chatAi={chatAi} userLlm={userLlmCfg} onSaveUserLlm={onSaveUserLlm} validateUserLlm={validateUserLlmConfig} onReconnectPeer={bundle?.reconnectPeer} />
      </WithTabBar>
    );
  }
  if (view === 'availability') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleAvailabilityScreen
          store={availabilityStore}
          onHop={() => setView('hop')}
        />
      </WithTabBar>
    );
  }
  // P5 — Contacten: the bot/peer roster + a 1:1 DM thread (mobile parity with web).
  if (view === 'contacten') {
    if (contactThread) {
      // cluster J — a feedback bot is a co-hosted agent, not a PeerGraph peer: open the dedicated feedback
      // thread (activates the verify pods) instead of the peer-DM thread.
      if (contactThread.isFeedback) {
        return (
          <WithTabBar active="contacten" onSelect={onTab}>
            <FeedbackThreadScreen
              session={sessionRef?.current ?? null}
              bot={contactThread.bot}
              store={feedbackStore}
              onBack={() => setContactThread(null)}
            />
          </WithTabBar>
        );
      }
      return (
        <WithTabBar active="contacten" onSelect={onTab}>
          <ContactThreadScreen
            bundle={bundle}
            contact={contactThread}
            onBack={() => setContactThread(null)}
          />
        </WithTabBar>
      );
    }
    return (
      <WithTabBar active="contacten" onSelect={onTab}>
        <ContactsScreen bundle={bundle} feedbackStore={feedbackStore} onOpen={(contact) => setContactThread(contact)} />
      </WithTabBar>
    );
  }
  if (view === 'stream') {
    return (
      <WithTabBar active="stroom" onSelect={onTab}>
        <CircleStreamScreen
          eventLog={eventLog}
          circles={circles}
          onOpenCircle={(id) => openCircle(circles.find((c) => c.id === id) || { id })}
        />
      </WithTabBar>
    );
  }
  // S3 — group admin panel (member roster + remove + announcements + moderation).
  if (selected && view === 'admin') {
    return (
      <CircleAdminPanelScreen
        callSkill={bundle?.callSkill}
        groupId={selected.id}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'lists') {   // cluster K · K2 — the composable lists/container UI (web≡mobile)
    return <CircleListsScreen circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'share') {   // objective L — the cross-circle share UI (web≡mobile)
    // Thread the signed-in member's WebID as the acting identity (initiator gate `by` + read subject
    // `recipient`), mirroring web's circleOwnerWebId. Null when signed out ⇒ the wrappers keep deny-by-default.
    const actorWebId = getCircleActorWebId();
    return (
      <CircleShareScreen
        circleId={selected.id} policy={selectedPolicy}
        by={actorWebId} recipient={actorWebId}
        circles={circles} contacts={shareContacts}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'settings') {
    // γ-next.policy — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingPolicy` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    //
    // Send-side: the settings editor owns the `store.update` call (so
    // proposal + commit paths route through one place); we wrap the
    // store here so a fresh update fans the post-save policy out to
    // peers via stoop's `broadcastKringPolicy`.  Fire-and-forget;
    // per-peer errors land in result.errors which we log.  No-op when
    // callSkill / no agent.
    const broadcastingStore = {
      ...policyStore,
      update: async (cid, next) => {
        const r = await policyStore.update(cid, next);
        if (next && typeof next === 'object' && typeof bundle?.callSkill === 'function') {
          const msgId = `kring-policy-${cid}-${Date.now()}`;
          const ts    = Date.now();
          bundle.callSkill('stoop', 'broadcastKringPolicy', {
            groupId: cid, policy: next, msgId, ts,
          }).then((res) => {
            if (res?.error) console.warn('[kring-policy] fan-out skipped:', res.error);
          }).catch((err) => {
            console.warn('[kring-policy] fan-out failed:', err?.message ?? err);
          });
        }
        return r;
      },
    };
    return (
      <CircleSettingsScreen
        store={broadcastingStore}
        proposalStore={proposalStore}
        circleId={selected.id}
        callSkill={bundle?.callSkill}
        // B · consent-card — inject the member-override store (records declined optional caps as
        // capabilityOptOuts) + the pod session's authed fetch, exactly as web circleApp.js does.
        overrideStore={overrideStore}
        podFetch={getCirclePodFetch() || undefined}
        incomingPolicy={incomingPolicy}
        onIncomingApplied={clearIncomingPolicy}
        onIncomingDiscarded={clearIncomingPolicy}
        // OBJ-2 — paired devices (no-pod sync). The agent exposes the household roster surface.
        householdSelfAddr={bundle?.agent?.householdSelfAddr ?? null}
        householdPeers={bundle?.agent?.listHouseholdPeers?.(selected.id) ?? []}
        onAddHouseholdPeer={(addr) => (bundle?.agent?.pairWithPeer ?? bundle?.agent?.addHouseholdPeer)?.(selected.id, addr)}
        onRemoveHouseholdPeer={(addr) => bundle?.agent?.removeHouseholdPeer?.(selected.id, addr)}
        // #80 — re-read the just-saved policy so CircleDetail's gate/tabs/catalog update live
        // (the settings onSave awaits store.update before calling onBack, so this sees the new value).
        onBack={() => { refreshProposals(); reloadSelectedPolicy(); setView('detail'); }}
      />
    );
  }
  if (selected && view === 'override') {
    return <CircleOverrideScreen store={overrideStore} policyStore={policyStore} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'viewas') {
    // F-5.1 — real member directory loaded in onViewAs via listGroupMembers.
    return <CircleViewAsScreen members={viewAsMembers} policy={viewAsPolicy} onBack={() => setView('detail')} />;
  }
  if (view === 'hop') {
    // Hopping lives under the Mij tab (personal settings).
    return <CircleHopScreen callSkill={callSkill} onBack={() => setView('availability')} />;
  }
  if (view === 'nearby') {
    // P6.8 #346 — Nearby/HIER screen.  Pulls peers from bundle.mdns when
    // wired; otherwise renders the empty-state copy from the substrate.
    const peers = bundle?.mdns?.peers ?? [];
    const model = buildNearbyModel({ peers, mySkills: [], t });
    return <NearbyScreen model={model} onBack={() => setView('list')} />;
  }
  if (view === 'mythings') {
    // P6.M7 #349 — Mijn dingen (private kring as notes-list, board 10A).
    return (
      <MyThingsScreen files={myThingsFiles} onBack={() => setView('list')} />
    );
  }
  if (selected && view === 'advisor') {
    return <CircleAdvisorScreen eventLog={eventLog} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'skills') {
    return (
      <CircleSkillEditorScreen
        skill={skillDraft}
        onSave={async (s) => {
          try { await AsyncStorage.setItem(`cc.circleSkill.${selected.id}`, JSON.stringify(s)); } catch { /* ignore */ }
          setSkillDraft(s);
          setView('detail');
        }}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'folio') {
    // F-5.2 — real files loaded in onFiles via listFiles, scoped to the circle.
    return (
      <CircleFolioScreen
        files={folioFiles}
        rawFiles={rawFolioFiles}
        circleId={selected.id}
        myCircles={circles}
        capabilityMatrix={folioCapMatrix}
        appOrigin="folio"
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'rules') {
    // γ-next.rules — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingRules` is null the screen
    // renders untouched.  Applied / discarded both clear the cache.
    return (
      <CircleRulesScreen
        doc={rulesDoc}
        incomingRules={incomingRules}
        rulesStore={rulesStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRules}
        onIncomingDiscarded={clearIncomingRules}
        onBack={() => setView('detail')}
        onPreview={(working) => { setRulesPreview(working); setView('rulesconsent'); }}
        onSave={async (doc) => {
          // γ.2 — saves go through rulesStore so the versions adapter
          // snapshots the doc into cc.versions.rules.<id> before the
          // canonical write lands.
          try { await rulesStore.set(selected.id, doc); } catch { /* ignore */ }
          setRulesDoc(doc);
          // γ-next.rules — fan the just-saved rules doc out to peers.
          // Fire-and-forget; per-peer errors land in result.errors which
          // we log.  No-op when callSkill / no agent / no doc.
          if (doc && typeof bundle?.callSkill === 'function') {
            const msgId = `kring-rules-${selected.id}-${Date.now()}`;
            const ts    = Date.now();
            bundle.callSkill('stoop', 'broadcastKringRules', {
              groupId: selected.id, rulesDoc: doc, msgId, ts,
            }).then((r) => {
              if (r?.error) console.warn('[kring-rules] fan-out skipped:', r.error);
            }).catch((err) => {
              console.warn('[kring-rules] fan-out failed:', err?.message ?? err);
            });
          }
          setView('detail');
        }}
      />
    );
  }
  if (selected && view === 'rulesconsent') {
    // Preview from the editor: Agree/Decline just return (real join-flow consent is the follow-on).
    return (
      <CircleRulesConsentScreen
        doc={rulesPreview}
        onBack={() => setView('rules')}
        onAgree={() => setView('rules')}
        onDecline={() => setView('rules')}
      />
    );
  }
  if (selected && view === 'recipes') {
    // α.1d.3 — recipe editor (book ↔ recipe modes; persistence flows
    // through recipeStore via applyRecipeMutation).
    return (
      <CircleRecipeEditorScreen
        book={recipeBook}
        mode={recipeEditorMode}
        editingRecipeId={recipeEditingId}
        // γ-next.recipe — broadcast cache → editor → γ.3 resolver.
        incomingRecipe={incomingRecipe}
        recipeStore={recipeStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRecipe}
        onIncomingDiscarded={clearIncomingRecipe}
        onBack={() => setView('detail')}
        onOpenRecipe={(rid) => { setRecipeEditingId(rid); setRecipeEditorMode('recipe'); }}
        onBackToBook={() => { setRecipeEditorMode('book'); setRecipeEditingId(null); }}
        onAddRecipe={(name) => applyRecipeMutation(selected.id, (cur) => addRecipe(cur, name))}
        onRenameRecipe={(rid, name) => applyRecipeMutation(selected.id, (cur) => renameRecipe(cur, rid, name))}
        onRemoveRecipe={(rid) => applyRecipeMutation(selected.id, (cur) => removeRecipe(cur, rid))}
        onSetActive={(rid) => applyRecipeMutation(selected.id, (cur) => setActiveRecipe(cur, rid))}
        onAddBlock={(rid, type) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => addBlock(r, type)))}
        onRemoveBlock={(rid, bid) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => removeBlock(r, bid)))}
        onMoveBlock={(rid, bid, idx) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => moveBlock(r, bid, idx)))}
        onUpdateBlock={(rid, bid, patch) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => updateBlock(r, bid, patch)))}
      />
    );
  }
  if (selected) {
    return (
      <CircleDetail
        circle={selected}
        items={items}
        callSkill={callSkill}
        rawCallSkill={bundle?.callSkill}
        catalog={bundle?.catalog}
        policy={selectedPolicy}
        myListTasks={myListTasks}
        eventLog={eventLog}
        circles={circles}
        recipeStore={recipeStore}
        onStoopEvent={bundle?.onStoopEvent}
        onBack={closeCircle}
        onInvite={() => openCircleInvite(selected.id)}
        onSettings={() => setView('settings')}
        onAdmin={() => setView('admin')}
        onMine={() => setView('override')}
        onViewAs={async () => {
          const p = await policyStore.get(selected.id);
          setViewAsPolicy(p?.revealPolicy ?? 'pairwise');
          let mem = [];
          if (callSkill) {
            try { mem = normalizeCircleMembers(await callSkill('listGroupMembers', { groupId: selected.id })); } catch { /* keep empty */ }
          }
          setViewAsMembers(mem);
          setView('viewas');
        }}
        onAdvisor={() => setView('advisor')}
        onSkills={async () => {
          let raw = null;
          try { const s = await AsyncStorage.getItem(`cc.circleSkill.${selected.id}`); if (s) raw = JSON.parse(s); } catch { /* fresh */ }
          setSkillDraft(raw);
          setView('skills');
        }}
        onFiles={async () => {
          let fs = [];
          let raw = null;
          if (callSkill) {
            try {
              raw = await callSkill('listFiles', {});
              fs = circleFilesFromListFiles(raw, selected.id);
            } catch { /* keep empty */ }
          }
          setFolioFiles(fs);
          // P6.M8 #350 — keep the raw list so the share-toggle pills can
          // re-project without a refetch.  Unwrap to a plain array if the
          // result is wrapped (`{items}` / `{files}`).
          const rawArr = !raw ? null
            : Array.isArray(raw.items) ? raw.items
            : Array.isArray(raw.files) ? raw.files
            : Array.isArray(raw) ? raw : null;
          setRawFolioFiles(rawArr);
          setView('folio');
        }}
        onRules={async () => {
          // γ.2 — load via rulesStore (same on-disk key as before:
          // `cc.circleRules.<id>`).
          let doc = null;
          try { doc = await rulesStore.get(selected.id); } catch { /* fresh */ }
          setRulesDoc(doc);
          setView('rules');
        }}
        onRecipes={async () => {
          await refreshRecipeBook(selected.id);
          setRecipeEditorMode('book');
          setRecipeEditingId(null);
          setView('recipes');
        }}
        onLists={() => setView('lists')}
        onShare={() => { loadShareContacts(); setView('share'); }}
      />
    );
  }

  return (
    <WithTabBar active="kringen" onSelect={onTab}>
      <View style={styles.page} testID="circle-launcher">
        {/* SP-13.1 — no "← chat" button (no chat shell to navigate to). */}
        <Text style={styles.title}>{t('circle.title')}</Text>

        {loading ? (
          <Text style={styles.muted}>{t('circle.loading')}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {bundle?.mdns ? (
              <View style={styles.nearbyRow} testID="circle-nearby">
                <Text style={styles.nearbyText}>
                  {formatNearbyLabel(nearbyCount, t)}
                </Text>
              </View>
            ) : null}

            {/* β.1 — Nearby + Mijn dingen launcher shortcuts removed.
                Nearby lives under the Mij tab; My-things is a seeded screen
                under the Schermen tab. */}
            {circles.length === 0 ? (
              <Text style={styles.muted}>{t('circle.empty')}</Text>
            ) : (
              renderLauncherGroups(circles, {
                previews, proposalCounts, openCircle,
                // β.5 — pin partition + long-press menu wiring.
                pinnedMap, mutedMap, onOpenMenu: openTileMenu,
              })
            )}

            {creating ? (
              <View style={styles.createRow}>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('circle.new')}
                  autoFocus
                  onSubmitEditing={submitCreate}
                  returnKeyType="done"
                />
                <Pressable style={styles.createBtn} accessibilityRole="button" onPress={submitCreate}>
                  <Text style={styles.createBtnText}>✓</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.newBtn}
                accessibilityRole="button"
                onPress={() => setCreating(true)}
              >
                <Text style={styles.newText}>{t('circle.new')}</Text>
              </Pressable>
            )}
            {!creating ? (
              <Pressable style={styles.joinBtn} accessibilityRole="button" onPress={() => setJoinScanOpen(true)}>
                <Text style={styles.joinText}>{t('circle.join.button')}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
        {/* OBJ-2 — scan an invite QR, then run the shared join wizard (no-pod redeem via the bundle's sender). */}
        <QrScannerModal visible={joinScanOpen} onClose={() => setJoinScanOpen(false)} onResult={onJoinScan} t={t} />
        {/* Mount only once we have the invite — the wizard decodes it in its useState initializer (runs
            once on mount), so an always-mounted modal would cache a "no invite" error. */}
        {joinArgs ? (
          <JoinGroupWizardModal
            visible
            args={joinArgs}
            callSkill={bundle?.callSkill}
            sendPeerRedeem={bundle?.sendPeerRedeem}
            t={t}
            onClose={() => setJoinArgs(null)}
            onDispatched={(r) => {
              setJoinArgs(null);
              const gid = r?.groupId ?? r?.joinedGroupId ?? null;
              if (gid) feedHouseholdRoster({ agent: bundle?.agent, circleId: gid }).catch(() => {});
              load();
            }}
          />
        ) : null}
        {/* OBJ-2 — invite QR for a circle (admin shows it; another device scans). */}
        <Modal visible={!!inviteFor} transparent animationType="fade" onRequestClose={() => setInviteFor(null)}>
          <Pressable style={styles.inviteBackdrop} onPress={() => setInviteFor(null)}>
            <Pressable style={styles.inviteCard} onPress={() => {}}>
              <Text style={styles.inviteTitle}>{t('circle.invite.title')}</Text>
              {inviteFor?.uri ? (
                <>
                  <QrCodeView value={inviteFor.uri} size={200} />
                  <Text style={styles.inviteHint}>{t('circle.invite.hint')}</Text>
                </>
              ) : (
                <Text style={styles.inviteHint}>{inviteFor?.error === 'admin-only' ? t('circle.invite.admin_only') : t('circle.invite.no_code')}</Text>
              )}
            </Pressable>
          </Pressable>
        </Modal>
        {/* β.5 — per-tile context menu, rendered as a transparent modal
            so a tap outside the sheet dismisses it.  The four actions
            mirror web: pin (toggle), mute (toggle), settings, leave. */}
        <Modal
          transparent
          visible={!!menuCircle}
          animationType="fade"
          onRequestClose={closeTileMenu}
        >
          <Pressable
            style={styles.tileMenuBackdrop}
            onPress={closeTileMenu}
            testID="circle-launcher-tile-menu-backdrop"
          >
            <View style={styles.tileMenuSheet} testID="circle-launcher-tile-menu">
              {(() => {
                if (!menuCircle) return null;
                const cid = menuCircle.id;
                const isPinned = !!pinnedMap[cid];
                const isMuted  = !!mutedMap[cid];
                const items = [
                  {
                    key: 'invite',
                    label: t('circle.invite.menu'),
                    onPress: () => { closeTileMenu(); openCircleInvite(cid); },
                  },
                  {
                    key: 'pin',
                    label: t(isPinned ? 'circle.tile.menu.unpin' : 'circle.tile.menu.pin'),
                    onPress: () => { closeTileMenu(); onPinCircle(cid); },
                  },
                  {
                    key: 'mute',
                    label: t(isMuted ? 'circle.tile.menu.unmute' : 'circle.tile.menu.mute'),
                    onPress: () => { closeTileMenu(); onMuteCircle(cid); },
                  },
                  {
                    key: 'settings',
                    label: t('circle.tile.menu.settings'),
                    onPress: () => {
                      closeTileMenu();
                      setSelected(menuCircle);
                      setView('settings');
                    },
                  },
                  {
                    key: 'leave',
                    label: t('circle.tile.menu.leave'),
                    onPress: () => {
                      closeTileMenu();
                      onLeaveCircle(cid, menuCircle);
                    },
                  },
                ];
                return items.map((it) => (
                  <Pressable
                    key={it.key}
                    style={styles.tileMenuItem}
                    onPress={it.onPress}
                    accessibilityRole="button"
                    testID={`circle-launcher-tile-menu-${it.key}`}
                  >
                    <Text style={styles.tileMenuItemText}>{it.label}</Text>
                  </Pressable>
                ));
              })()}
            </View>
          </Pressable>
        </Modal>
      </View>
    </WithTabBar>
  );
}

// β.3 — fixed display order for kring-kind section headers; anything not in
// this list is bucketed under 'other' (last).  Mirrors web circleLauncher.js
// and the values produced by the create wizard + circleModel.normalizeCircle.
const KIND_ORDER = ['household', 'buurt', 'vriendenkring'];

/**
 * β.1+β.2+β.3+β.5 — render the kringen list:
 *   - β.2 sort by recent activity (preview.ts desc; stable name tiebreak)
 *   - β.5 partition into pinned + unpinned within each section (pins
 *     float to the top of their kind section without escaping it)
 *   - β.3 group by `kind` with section headers (KIND_ORDER then 'other');
 *     when all kringen share one kind, headers are skipped (flat list).
 */
function renderLauncherGroups(circles, {
  previews, proposalCounts, openCircle,
  pinnedMap = {}, mutedMap = {}, onOpenMenu,
}) {
  const sorted = [...circles].sort((a, b) => {
    const ta = previews?.[a.id]?.ts ?? 0;
    const tb = previews?.[b.id]?.ts ?? 0;
    if (tb !== ta) return tb - ta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  // β.5 — partition by pin BEFORE grouping so pinned tiles float to the
  // top of their kind section without escaping it.
  const pinned = sorted.filter((c) => pinnedMap[c.id]);
  const unpinned = sorted.filter((c) => !pinnedMap[c.id]);
  const ordered = [...pinned, ...unpinned];

  const groups = new Map();
  for (const c of ordered) {
    const k = KIND_ORDER.includes(c.kind) ? c.kind : 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const orderedKinds = [...KIND_ORDER, 'other'].filter((k) => groups.has(k));
  const showHeaders = orderedKinds.length > 1;
  if (!showHeaders) {
    return ordered.map((c) => (
      <LauncherTile
        key={c.id}
        circle={c}
        preview={previews?.[c.id]}
        pending={Number(proposalCounts?.[c.id]) || 0}
        isPinned={!!pinnedMap[c.id]}
        isMuted={!!mutedMap[c.id]}
        onOpen={openCircle}
        onLongPress={onOpenMenu}
      />
    ));
  }
  return orderedKinds.map((kind) => (
    <View key={`section-${kind}`} style={styles.section} testID={`circle-launcher-section-${kind}`}>
      <Text style={styles.sectionTitle}>{t(`circle.kind.${kind}`)}</Text>
      {groups.get(kind).map((c) => (
        <LauncherTile
          key={c.id}
          circle={c}
          preview={previews?.[c.id]}
          pending={Number(proposalCounts?.[c.id]) || 0}
          isPinned={!!pinnedMap[c.id]}
          isMuted={!!mutedMap[c.id]}
          onOpen={openCircle}
          onLongPress={onOpenMenu}
        />
      ))}
    </View>
  ));
}

/** Single kring tile (extracted in β.3 so grouped + flat paths share it). */
function LauncherTile({ circle: c, preview, pending, isPinned = false, isMuted = false, onOpen, onLongPress }) {
  const subtitle = (preview && preview.subtitle)
    ? preview.subtitle
    : (c.memberCount != null ? t('circle.members', { count: c.memberCount }) : null);
  const unread = preview?.unread ?? 0;
  return (
    <Pressable
      style={[styles.tile, isPinned && styles.tilePinned]}
      accessibilityRole="button"
      onPress={() => onOpen(c)}
      onLongPress={typeof onLongPress === 'function' ? () => onLongPress(c) : undefined}
      testID={`circle-tile-${c.id}`}
    >
      <View style={styles.tileBody}>
        <Text style={styles.tileName}>{c.name}</Text>
        {subtitle ? (
          <Text style={styles.tileMeta} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {unread > 0 ? (
        <View
          style={styles.tileUnread}
          accessibilityLabel={t('circle.tile_unread', { count: unread })}
        >
          <Text style={styles.tileUnreadText}>{unread}</Text>
        </View>
      ) : null}
      {pending > 0 ? (
        <View
          style={styles.tileProposals}
          accessibilityLabel={t('circle.tile_proposals', { count: pending })}
          testID={`circle-tile-proposals-${c.id}`}
        >
          <Text style={styles.tileProposalsText}>{pending}</Text>
        </View>
      ) : null}
      {isPinned ? (
        <Text
          style={styles.tilePinIndicator}
          accessibilityElementsHidden
          testID={`circle-tile-pin-${c.id}`}
        >
          {'\u{1F4CC}'}
        </Text>
      ) : null}
      {/* Defensively reference `isMuted` so the tile component reads the
          prop (consumers visualize muted state via the menu's Unmute
          label; a tile-level dim is a follow-up polish). */}
      {isMuted ? null : null}
    </Pressable>
  );
}

// SP-13 — kring content view (board 2B / 8C).  Replaces the action-grid
// scaffolding as the per-circle landing surface.  Admin actions
// (Settings, Mine, ViewAs, …) collapse into a `⋯` overflow menu in the
// header, gated on the Functies axis (same gates the old grid used).
// B (circle bot) — the one-line kring-bubble reply text is now the SHARED `kringReplyText` (verb-aware
// Added:/Completed: phrasing); web + mobile use it so add/complete no longer read identically.

function CircleDetail({
  circle, items, callSkill, rawCallSkill, catalog: rawCatalog, policy, myListTasks = [],
  eventLog, circles = [],
  recipeStore = null, onStoopEvent,
  onBack, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules, onRecipes, onAdmin, onLists, onShare, onInvite,
}) {
  // Part D — scope the bot/suggest catalog to the circle's apps: drops canopy-chat's infra ops (/me etc.)
  // that the circle bot can't run (they threw `circle.bot.failed`) and keeps them out of the suggest list.
  const catalog = useMemo(
    () => (rawCatalog ? scopeCatalogToApps(rawCatalog, policy?.apps) : rawCatalog),
    [rawCatalog, policy],
  );
  // S6.A — {appOrigin → manifest} for computing inline buttons on bot replies.
  const manifestsByOrigin = useMemo(() => buildManifestsByOrigin(), []);
  // B · Slice 1 — the manifest sources the capability gate reads (deduped; web≡mobile with circleApp.baseSources).
  const capabilitySources = useMemo(
    () => [...new Set(Object.values(manifestsByOrigin))].map((manifest) => ({ manifest })),
    [manifestsByOrigin],
  );
  // B · Slice 4 — the member-override store (per-circle opt-outs) that the capability matrix reads.
  // CircleDetail is a separate component from the outer CircleLauncherScreen, so it needs its own
  // handle; the store is a stateless AsyncStorage wrapper, so a second instance is free.
  const overrideStore = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  // Per-circle stoop restructure (parity with web circleApp.js `stoopCall`): the
  // prikbord + scherm noticeboard block call the raw 3-arg `callSkill('stoop', …)`
  // directly, bypassing scopeReadyDispatch — so scope them to THIS circle here.
  // Writes get the circle id as the stoop scope key; list reads are filtered to the
  // circle. One shared agent, per-circle scope key (NOT N agents). NB: the 3-arg raw
  // dispatch is the `rawCallSkill` PROP (the parent's `bundle.callSkill`) — `bundle`
  // is not in scope in this component.
  // Sealed media (2026-07-11): thread THIS circle's media gateway into the wrapper (4th arg,
  // web parity with circleApp.js `getStoopMedia`) so a prikbord image attachment seals + rides
  // the SAME `{type:'media'}` blob pointer canopy-chat's own circle chat images use — one
  // circle's gateway per wrapper ⇒ per-circle by construction (no cross-seal). A p0/p1 circle
  // resolves no composition → the wrapper refuses attachments (sealed-only) and the 📎 hides.
  const getStoopMedia = useCallback(async () => {
    const comp = await getCircleMediaComposition(circle?.id, policy);
    return (comp && comp.mediaGateway)
      ? { mediaGateway: comp.mediaGateway, localActor: getCircleActorWebId() || 'me', t }
      : null;
  }, [circle?.id, policy]);
  const stoopCall = useMemo(
    () => scopeStoopCallSkill(
      rawCallSkill, circle?.id, () => getCircleSealStrategy(circle?.id, policy), getStoopMedia,
    ),
    [rawCallSkill, circle?.id, policy, getStoopMedia],
  );
  // Resolve this circle's sealed-media composition for the noticeboard: gate the 📎 affordance
  // (null for p0/p1 → hidden, web parity `kringMedia ? ... : null`) + open sealed full images on
  // tap. Async: the seal strategy rides the pod producer; null until it resolves and FOREVER for
  // p0/p1 (sealed-only, no unsealed upload fallback).
  const [circleMedia, setCircleMedia] = useState(null);
  useEffect(() => {
    let alive = true;
    setCircleMedia(null);
    getCircleMediaComposition(circle?.id, policy).then((m) => { if (alive) setCircleMedia(m || null); });
    return () => { alive = false; };
  }, [circle?.id, policy]);
  // S4 — seed a sealed circle's group-key roster with members who joined before the producer
  // was live (web parity with showKring). Best-effort; no-op for unsealed circles.
  useEffect(() => {
    if (circle?.id && typeof rawCallSkill === 'function') {
      seedCircleRosterFor({ circleId: circle.id, policy, callSkill: rawCallSkill }).catch(() => {});
    }
  }, [circle?.id, rawCallSkill, policy]);
  // P6.1 — Functies-axis gating for the overflow menu items now rides the
  // projection: the shared `circleActionsMobile` selector evaluates each
  // action's `requires` gate against `policy` (see the ⋯-menu render below).

  // SP-13.2 — kring stream rows scoped to this circle (chat-style).
  // EventLog has no subscribe seam yet; bumping `streamTick` after
  // local appends forces the memo to re-pull.
  const [streamTick, setStreamTick] = useState(0);
  const rows = useMemo(() => buildKringStream({
    events:    eventLog?.query ? eventLog.query({ excludeMuted: true }) : [],
    circles,
    circleId:  circle?.id ?? null,
  }), [eventLog, circles, circle?.id, streamTick]);
  // Conversation memory — a ref so the bot reads the LATEST rows without re-creating.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // δ.2 — per-message delivery state.  Lives in a ref so the map is
  // stable across renders; we bump `deliveryTick` (a state value the
  // bubble render reads through `deliveryStateFor`) to force re-renders
  // when state flips.  The map itself isn't deps-tracked.
  const deliveryStateMapRef = useRef(null);
  const feedbackMountRef = useRef(null);   // M6 — lazy feedback mount (created on first kring send)
  const lastKringListingRef = useRef(null); // { appOrigin, items } from the last list reply, for bulk "/done all"
  if (deliveryStateMapRef.current == null) deliveryStateMapRef.current = createDeliveryStateMap();
  const [deliveryTick, setDeliveryTick] = useState(0);
  const deliveryStateFor = useCallback((msgId) => {
    // eslint-disable-next-line no-unused-expressions
    deliveryTick; // read tick so memoised consumers re-evaluate on bumps
    return deliveryStateMapRef.current.get(msgId);
  }, [deliveryTick]);
  const [composerText, setComposerText] = useState('');
  // Conversational follow-up: a single-field needsForm awaiting the user's next message (shared followUp).
  const [pendingFollowUp, setPendingFollowUp] = useState(null);
  const [pendingForm, setPendingForm] = useState(null);   // 2+-field needsForm → inline form (parity with web)
  // The bot asked a free-text QUESTION (an llm-reply containing '?') — route the user's NEXT line straight
  // back to it (no '@assistant' needed) so the conversation continues. We stash {question, query} so the
  // answer is interpreted WITH the prior exchange threaded as conversation. Cleared once consumed.
  const [awaitingBotReply, setAwaitingBotReply] = useState(null);
  const noteBotTurn = useCallback((r, query) => {
    const reply = r && r.via === 'llm-reply' && typeof r.reply === 'string' ? r.reply.trim() : '';
    setAwaitingBotReply(reply && /\?/.test(reply) ? { question: reply, query: String(query || '') } : null);
  }, []);
  // Composer parity — slash-command auto-suggest off the merged catalog (shared `suggestCommands`,
  // same logic + set as web's dropdown). Tapping a row fills the command; the bash-style ArrowUp/Down
  // history that web also has is a keyboard affordance with no touch-gesture equivalent, so it's
  // intentionally desktop-only (the suggest list is the mobile parity surface).
  const suggestMatches = useMemo(
    () => (catalog ? suggestCommands(catalog, composerText) : []),
    [catalog, composerText],
  );
  // Permission gate (classic shell's `allowCommands` analog): chat disabled for this circle ⇒ read-only.
  const canPost = isFeatureEnabled(policy, 'chat');
  // SP-13.3 — per-kring bottom tabs derived from policy.features.
  const tabs = useMemo(() => buildKringTabs(policy, t), [policy]);
  const [activeTab, setActiveTab] = useState(DEFAULT_KRING_TAB);
  // Reset to GESPREK whenever we switch kringen so a non-default tab
  // doesn't persist across opens.
  useEffect(() => { setActiveTab(DEFAULT_KRING_TAB); }, [circle?.id]);

  // LEDEN (members) tab — real roster via listGroupMembers (web≡mobile; mirrors web's directory load).
  // null = not loaded yet, [] = loaded empty. Loads lazily when the tab is opened (per circle).
  const [tabMembers, setTabMembers] = useState(null);
  useEffect(() => {
    if (activeTab !== 'leden' || !circle?.id || typeof rawCallSkill !== 'function') return undefined;
    let alive = true;
    setTabMembers(null);
    (async () => {
      let mem = [];
      try { mem = normalizeCircleMembers(await rawCallSkill('stoop', 'listGroupMembers', { groupId: circle.id })); } catch { /* keep empty */ }
      if (alive) setTabMembers(mem);
    })();
    return () => { alive = false; };
  }, [activeTab, circle?.id, rawCallSkill]);

  // α.1e — materialized scherm blocks for the active recipe.  null
  // until the load below resolves; [] when the book is empty.
  // D1 — `screenReloadTick` bumps after a quickActions tap to re-rank.
  const [screenBlocks, setScreenBlocks] = useState(null);
  const [screenReloadTick, setScreenReloadTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setScreenBlocks(null);  // reset on circle change
    if (!recipeStore || !circle?.id) { setScreenBlocks([]); return () => { alive = false; }; }
    (async () => {
      try {
        const book = await recipeStore.get(circle.id);
        // D1 (§5A) — fall back to the quickActions-only default recipe so
        // every scherm leads with the Veel-gebruikt row.
        const active = getActiveRecipe(book) ?? DEFAULT_SCHERM_RECIPE;
        const blocks = await materializeRecipe({
          recipe:   active,
          circleId: circle.id,
          // D1 — policy + actionFrequency feed the quickActions block. The block
          // materializers call `callSkill(appOrigin, opId, args)` (3-arg), so pass
          // the RAW 3-arg dispatch, not the 2-arg `callSkill` resolver (#16; also
          // un-breaks the tasks/agenda scherm blocks that shared the latent bug).
          // `stoopCall` = the raw 3-arg `rawCallSkill` scoped to this circle (the
          // earlier `bundle?.callSkill` was undefined here — `bundle` isn't a prop).
          hostOps:  { callSkill: stoopCall, eventLog, circles, policy, actionFrequency, fetchImpl: getCirclePodFetch() || undefined },
        });
        if (alive) setScreenBlocks(blocks);
      } catch (err) {
        console.warn('[CircleDetail] recipe load failed:', err?.message ?? err);
        if (alive) setScreenBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [recipeStore, circle?.id, callSkill, eventLog, circles, policy, screenReloadTick]);

  // SP-13.4 — Chat ↔ Scherm pill state (v2 §4 "De Schakelaar").
  // Per-circle preference persists in AsyncStorage at cc.circleViewMode.
  // §4 — until the member has flipped the pill for this kring, the
  // landing surface is the admin's policy.view front door
  // (defaultViewModeFromPolicy): 'screen' → scherm, else → chat.
  const [viewMode, setViewModeState] = useState(() => defaultViewModeFromPolicy(policy));
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!circle?.id) return;
      const fallback = defaultViewModeFromPolicy(policy);
      try {
        const raw = await AsyncStorage.getItem('cc.circleViewMode');
        const map = raw ? JSON.parse(raw) : {};
        const saved = map?.[circle.id];
        if (alive) setViewModeState(saved === 'scherm' || saved === 'chat' ? saved : fallback);
      } catch { if (alive) setViewModeState(fallback); }
    })();
    return () => { alive = false; };
  }, [circle?.id, policy]);
  const setViewMode = useCallback(async (mode) => {
    if (mode !== 'chat' && mode !== 'scherm') return;
    setViewModeState(mode);
    if (!circle?.id) return;
    try {
      const raw = await AsyncStorage.getItem('cc.circleViewMode');
      const map = raw ? JSON.parse(raw) : {};
      map[circle.id] = mode;
      await AsyncStorage.setItem('cc.circleViewMode', JSON.stringify(map));
    } catch { /* quota / disabled */ }
  }, [circle?.id]);

  // D1 (§5A) — a "Veel-gebruikt" pill tap: bump the feature's count, route
  // it (tab feature → switch to it in chat view; houseRules → rules panel),
  // then re-rank the row.  Mirrors the web onScreenAction.
  const onScreenAction = useCallback((featureKey) => {
    if (!circle?.id) return;
    actionFrequency.bump(circle.id, featureKey);
    if (featureKey === 'houseRules') { onRules?.(); }
    else {
      const tabId = featureTabId(featureKey);
      if (tabId) { setActiveTab(tabId); setViewMode('chat'); }
    }
    setScreenReloadTick((n) => n + 1);
  }, [circle?.id, onRules, setViewMode]);

  // δ.2 — fan-out helper used by both the initial send and the
  // tap-to-retry handler for failed bubbles.  Re-fires with the
  // SAME msgId so receiver-side dedup suppresses duplicates.
  const broadcastFanOut = useCallback(({ msgId, text, ts }) => {
    // Shared fan-out (Phase 2). RAW 3-arg callSkill (app-targeted at stoop) — the 2-arg resolving one
    // arg-shifts (op→'stoop') and never delivers. The helper marks δ.2 delivery state; onChange = the
    // RN rerender tick.
    broadcastKringFanOut({
      rawCallSkill, circleId: circle?.id, msgId, text, ts,
      deliveryStateMap: deliveryStateMapRef.current,
      onChange: () => setDeliveryTick((n) => n + 1),
    });
  }, [rawCallSkill, circle?.id]);

  // SP-13.2.1 — append a kring chat bubble to the local eventLog (optimistic). Returns {msgId, ts}
  // so the caller can fan out the same id (receiver-side dedup suppresses any mirrored echo).
  const appendKringMessage = useCallback(({ actor, text, buttons, scope, embeds }) => {
    if (!eventLog?.append || !circle?.id) return null;
    const msgId = `kring-${circle.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts    = Date.now();
    eventLog.append(kringChatMessageEvent({ msgId, ts, circleId: circle.id, actor, text, buttons, scope, embeds }));
    setStreamTick((n) => n + 1);
    return { msgId, ts };
  }, [eventLog, circle?.id]);

  // B (circle bot) — run a FULLY-RESOLVED command ({opId, args}) against the circle's catalog, scoped
  // to THIS circle, and post a one-line bot reply. Local-only (the command's substrate effect reaches
  // members on its own). Target resolution / ambiguity is handled upstream by the clarifying dispatch.
  const runCircleCommandResolved = useCallback(async ({ opId, args, appOrigin }) => {
    if (!catalog) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    let dispatch;
    try {
      // K0 de-shadow: forward the app-origin hint so a colliding bare op-id (from the gate) routes to the
      // gate's app, not the merge's first-declarer (web≡mobile parity with circleApp.dispatchReady).
      dispatch = resolveDispatch({ kind: 'slash', opId, args: args || {}, appOrigin, command: '(bot)', body: '' }, catalog);
    } catch { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    if (dispatch.kind === 'needsForm') {
      // Conversational elicitation (parity with web): single missing field → ask in the kring + capture
      // the user's next message (sendKringChat's pending branch); 2+ missing fields → an inline form bubble.
      const pending = beginFollowUp({ dispatch, t });
      if (pending) { setPendingFollowUp(pending); appendKringMessage({ actor: 'bot', text: pending.promptText }); return; }
      const form = beginFormFollowUp({ dispatch, t });
      if (form) { setPendingForm(form); return; }   // renderer draws MultiFieldFormBubble
      appendKringMessage({ actor: 'bot', text: t('circle.bot.needsInfo') });   // no missing param names
      return;
    }
    // Q27 confirm gate (web≡mobile parity with circleApp.dispatchReady) — an op declaring
    // surfaces.ui.confirm (warn/danger) NEVER executes without an explicit accept. Sits at the dispatch
    // waist, so the row-button path and the chat/slash path are gated uniformly (shared runConfirmGate;
    // Alert.alert with a destructive accept is only the presenter). Cancel = quiet notice.
    if (dispatch.kind === 'needsConfirm') {
      await runConfirmGate({
        route: dispatch, catalog, t,
        present: alertConfirmPresenter(Alert.alert),
        onCancelNotice: () => appendKringMessage({ actor: 'bot', text: t('circle.confirm.cancelled') }),
        execute: executeResolved,
      });
      return;
    }
    if (dispatch.kind !== 'ready')     { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    await executeResolved(dispatch);

    // The execute tail every accepted route runs (direct 'ready' or confirmed 'needsConfirm' → 'ready').
    async function executeResolved(dispatch) {
      // B · Slice 1 — DEFAULT-DENY capability gate (web≡mobile parity with circleApp.dispatchReady). Every
      // user-initiated dispatch (slash/LLM/gate/button/follow-up) converges on runCircleCommandResolved.
      // Enablement comes from the SAME per-circle source the UI uses (isAppSurfaceEnabled → policy.features,
      // already consulted for the screen button below); the pure (verb×noun) gate evaluates the capability.
      if (circle?.id) {
        const gateEntry = catalog?.opsById?.get(dispatch.opId);
        const gOrigin = dispatch.appOrigin || gateEntry?.appOrigin;
        if (gOrigin) {
          const enabled = isAppSurfaceEnabled(gOrigin, policy, isFeatureEnabled);
          const eff = effectiveCapabilities(capabilitySources, { apps: enabled ? [gOrigin] : [] });
          const verdict = checkCapability({ op: gateEntry?.op, appOrigin: gOrigin, args: dispatch.args }, eff);
          if (!verdict.allow) {
            appendKringMessage({ actor: 'bot', text: t(verdict.code === 'app-disabled' ? 'circle.gate.appDisabled' : 'circle.gate.capabilityDenied') });
            return;
          }
        }
      }
      // scopeReadyDispatch takes the active-circle id STRING (it writes it into the scope arg keys);
      // an {id} object would land as the literal scope value (device-verify 2026-06-11).
      const scoped = scopeReadyDispatch(dispatch, circle?.id);
      if (typeof rawCallSkill !== 'function') { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
      let reply;
      // runDispatch calls callSkill(appOrigin, opId, args) — the RAW 3-arg shape, with appOrigin from
      // resolveDispatch. Pass the raw `rawCallSkill` (bundle.callSkill) DIRECTLY. The 2-arg *resolving*
      // callSkill (used for the picker lookup) silently arg-shifts here: appOrigin→opId, opId→args, real
      // args dropped — so the dispatched op was literally 'tasks-v0' and NO circle-bot command ever
      // executed on mobile (device-verify 2026-06-11: logs showed `[callSkill] tasks-v0 →` not `addTask →`).
      try { reply = await runDispatch(scoped, rawCallSkill); }
      catch (e) { appendKringMessage({ actor: 'bot', text: t('circle.bot.failed', { msg: e?.message ?? String(e) }) }); return; }
      // The op's verb drives Added:/Completed: phrasing (a bare "✓ X" was identical for add + complete).
      const entry = catalog?.opsById?.get(dispatch.opId);
      const verb = entry?.op?.verb;
      // S6.A — manifest-driven inline buttons for the reply's item(s), gated by appliesTo (web parity).
      // B · Slice 4 (4c) — grey/hide affordances per the member's effective capability + consequence (web≡mobile).
      let capMatrix = [];
      try {
        const ovr = circle?.id ? (await overrideStore.get(circle.id)) : null;
        capMatrix = buildCapabilityMatrix(capabilitySources, {
          enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
          template: policy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
        });
      } catch { /* best-effort — no greying on error */ }
      const inlineButtons = embedButtonsForReply({ reply, appOrigin: entry?.appOrigin, manifestsByOrigin, capabilityMatrix: capMatrix });
      // S6.B/C — a screen surface (surfaces.ui.screen) becomes an "Open …" button,
      // gated by the circle's policy.features for that app (web parity).
      const screen = entry?.op?.surfaces?.ui?.screen;
      const screenButton = (screen && isAppSurfaceEnabled(entry?.appOrigin, policy, isFeatureEnabled))
        ? [{ id: `screen:${screen}`, screen, label: t(`circle.screen.open.${screen}`, { defaultValue: t('circle.screen.open_generic') }) }]
        : [];
      // S6.C — the user's preference picks the projection (inline / screen / minimal). web parity.
      const buttons = selectSurfaceButtons({ inlineButtons, screenButton, pref: surfacePrefStore.get() });
      // Scope: a mutating op's reply reaches the whole kring; a read/info/error reply is private (web parity).
      const scope = scopeForReply({ verb, error: !!reply?.error });
      // embeds[] — the bot reply references the item it acted on (web parity); title pre-filled.
      const embeds = embedsFromReply(reply, { appOrigin: entry?.appOrigin });
      appendKringMessage({ actor: 'bot', text: kringReplyText(reply, { verb, t }), buttons, scope, embeds });
      // Remember the most-recent listing so a bulk "/done all" can fan out over it (web≡mobile).
      if (Array.isArray(reply?.payload?.items)) lastKringListingRef.current = { appOrigin: entry?.appOrigin, items: reply.payload.items };
      // Shared find-result enrichment (skill matches + hop prompt), web≡mobile via buildFindExtras. Best-effort.
      try {
        const { skillMatches, hopCard } = await buildFindExtras({
          query: reply?.payload?.query, groups: reply?.payload?.groups,
          circleId: circle?.id, callSkill: (op, a) => rawCallSkill('stoop', op, a), t,
        });
        if (skillMatches.length) appendKringMessage({ actor: 'bot', text: `${t('circle.skillMatches.title')}\n${skillMatches.map((m) => `• ${m.label} — ${m.skill}`).join('\n')}` });
        if (hopCard) appendKringMessage({ actor: 'bot', text: `${hopCard.title}\n${hopCard.body}` });
      } catch { /* enrichment is non-essential */ }
    }
  }, [catalog, circle?.id, rawCallSkill, appendKringMessage, manifestsByOrigin, policy, capabilitySources, overrideStore]);

  // E2 — run a bulk route ("/done all") over the most-recent listing's items (web≡mobile parity via the shared
  // executeBulkDispatch). Mobile has no filter-router; cross-thread propagation is the fan-out itself.
  const handleKringBulk = useCallback(async (route) => {
    const itemIds = (lastKringListingRef.current?.items ?? []).map((it) => it.id).filter(Boolean);
    if (!itemIds.length) { appendKringMessage({ actor: 'bot', text: t('circle.bulk.noList') }); return; }
    try {
      const { message } = await executeBulkDispatch({ bulk: route, itemIds, callSkill: rawCallSkill, opLabel: route.opId });
      appendKringMessage({ actor: 'bot', text: message });
    } catch (e) { appendKringMessage({ actor: 'bot', text: t('circle.bot.failed', { msg: e?.message ?? String(e) }) }); }
  }, [appendKringMessage, rawCallSkill]);

  // 2+-field inline form submit: echo the filled values, complete the dispatch, run it (parity with web).
  const onFormSubmit = useCallback((values) => {
    const pending = pendingForm;
    if (!pending) return;
    setPendingForm(null);
    const summary = (pending.fields || []).map((f) => `${f.label || f.name}: ${values?.[f.name] ?? ''}`).join(' · ');
    if (summary) appendKringMessage({ actor: 'me', text: summary });
    const ready = completeMultiFieldFollowUp({ pending, values });
    runCircleCommandResolved({ opId: ready.opId, args: ready.args });
  }, [pendingForm, appendKringMessage, runCircleCommandResolved]);

  // B (clarification) — candidate source for an id-like param. Base = the circle's already-loaded
  // items (tasks + stoop posts, circle-scoped). Part C cross-app: ALSO pull the op's OWN list via the
  // auto-resolving callSkill (makeResolvingCallSkill probes the right app by opId), so labels for item
  // types NOT in the preloaded set — folio files (listFiles), calendar events (listEvents) — resolve
  // too. Scoped to the circle (circleId/circleId/groupId); deduped by id; best-effort (failures keep base).
  // B (clarification) — the SHARED circle lookup (Phase 3, src/v2/circleLookup): base = the circle's
  // already-loaded items (tasks + stoop posts), plus the op's OWN list via the app-qualified
  // rawCallSkill (so `listOpen` resolves on the right app, not probe-first-origin). Was an inline copy.
  const circleLookup = useMemo(
    () => makeCircleLookup({ getBase: () => items, appCallSkill: rawCallSkill }),
    [items, rawCallSkill],
  );

  // B (clarification) — wraps dispatch: a unique target dispatches; an ambiguous one posts a bot
  // message with candidate BUTTONS (tapping → pick → re-run bound to that id); a missing one asks.
  const clarify = useMemo(() => createClarifyingDispatch({
    catalog: () => catalog,
    lookup: circleLookup,
    dispatchReady: runCircleCommandResolved,
    ask: ({ query, candidates }) => appendKringMessage({
      actor: 'bot',
      text: t('circle.clarify.which', { query }),
      buttons: candidates.map((c) => ({ id: c.id, label: c.hint ? `${c.label} — ${c.hint}` : c.label })),
    }),
    askMissing: async ({ opId, param, query }) => {
      // A non-empty label that matched nothing → "couldn't find X". A picker command given with NO value
      // (bare /complete-task) shouldn't say «couldn't find ''» — list the options to choose from.
      if (query && query.trim()) { appendKringMessage({ actor: 'bot', text: t('circle.clarify.notFound', { query }) }); return; }
      const entry = catalog?.opsById?.get(opId);
      const listOp = (entry?.op?.params || []).find((p) => p.name === param)?.pickerSource?.listOp;
      let cand = [];
      try { if (listOp) cand = (await circleLookup(listOp, '', circle?.id, entry?.appOrigin)) || []; } catch { /* keep empty */ }
      if (cand.length) {
        appendKringMessage({ actor: 'bot', text: `${t('circle.clarify.whichMissing')}\n${cand.map((c) => `• ${c.label}`).join('\n')}` });
      } else {
        appendKringMessage({ actor: 'bot', text: t('circle.clarify.noneToPick') });
      }
    },
  }), [catalog, circleLookup, runCircleCommandResolved, appendKringMessage, circle?.id]);

  // S6.B — chat-triggered screen panel ({screen} | null) + its materialized blocks.
  const [screenPanel, setScreenPanel] = useState(null);
  const [panelBlocks, setPanelBlocks] = useState(null);
  const [listScreenData, setListScreenData] = useState(null);   // B · Slice 3 — { items, categoryField, appOrigin, capabilityMatrix }
  // S6.B precise scroll-to — the panel ScrollView, its content wrapper, and the
  // single highlighted row.  measureLayout(row → content) gives the row's y in
  // content space, which scrollTo consumes directly.
  const panelScrollRef = useRef(null);
  const panelContentRef = useRef(null);
  const highlightRowRef = useRef(null);
  const scrollPanelToHighlight = useCallback(() => {
    const row = highlightRowRef.current;
    const content = panelContentRef.current;
    const scroller = panelScrollRef.current;
    if (!row || !content || !scroller || typeof row.measureLayout !== 'function') return;
    const contentNode = findNodeHandle(content);
    if (contentNode == null) return;
    row.measureLayout(
      contentNode,
      (_x, y) => { scroller.scrollTo({ y: Math.max(0, y - 12), animated: true }); },
      () => { /* measure failed (row unmounted) — leave scroll where it is */ },
    );
  }, []);
  // Re-nav within the panel (tapping a chip in an open panel changes highlightRef
  // without remounting the row, so onLayout won't refire) — scroll on ref change.
  useEffect(() => {
    if (screenPanel?.highlightRef) scrollPanelToHighlight();
  }, [screenPanel?.highlightRef, panelBlocks, scrollPanelToHighlight]);
  useEffect(() => {
    if (!screenPanel) { setPanelBlocks(null); setListScreenData(null); return undefined; }
    let alive = true;
    setPanelBlocks(null); setListScreenData(null);   // loading

    // B · Slice 3 — a declared LIST-SCREEN fetches rows + builds the member matrix, then renders the
    // interactive CircleListScreen (search + category chips + capability-gated rows) instead of a block.
    // D-mig-mobile-1b — resolve the list-screen config from the projected manifest
    // section (shared selector) instead of the retired hardcoded literal.
    // Q15 (web parity with openCircleScreenPanel) — the fetch now rides the SHARED
    // seam `fetchScreenItems`: static `dataSource.args` merged with `argsFromContext`
    // `$keys` substituted from the panel's context (`$circleId` host-materialized
    // from the active circle; `$uri`/`$agentId` selection-derived from a picked row).
    // The old path passed ONLY the static args — argsFromContext was ignored.
    const found = sectionForScreen(manifestsByOrigin, screenPanel.screen);
    if (found) {
      const { section, appOrigin } = found;
      const categoryField = section.categoryField;
      const searchFields = section.searchFields;
      const labelField = section.labelField ?? 'label';
      const screenContext = screenPanelContext(circle?.id, screenPanel.context);
      (async () => {
        try {
          const res = await fetchScreenItems(section, {
            callSkill: (skillId, args) => rawCallSkill(appOrigin, skillId, args),
            context: screenContext,
          });
          // Q17 — a record-shaped DETAIL (e.g. agent-detail) renders as a
          // read-only key→value record, not a list (web parity).
          if (section.shape === 'record') {
            if (alive) setListScreenData({ shape: 'record', record: recordFromReply(res), appOrigin });
            return;
          }
          const items = itemsFromReply(res);
          let capabilityMatrix = [];
          try {
            const ovr = circle?.id ? (await overrideStore.get(circle.id)) : null;
            capabilityMatrix = buildCapabilityMatrix(capabilitySources, {
              enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
              template: policy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
            });
          } catch { /* best-effort */ }
          // Q15 drill-down — when a sibling DETAIL view needs a selection-derived
          // context key (shared screenDrilldown over renderMobile), picking a row
          // opens it with that key materialized from the picked row; no drill
          // target → the rows stay plain (no row-open affordance), like web.
          const drill = drilldownForScreen(manifestsByOrigin, screenPanel.screen, screenContext);
          if (alive) setListScreenData({ items, categoryField, searchFields, labelField, appOrigin, capabilityMatrix, drill, screenContext });
        } catch {
          if (alive) {
            setListScreenData(section.shape === 'record'
              ? { shape: 'record', record: null, appOrigin }
              : { items: [], categoryField, searchFields, labelField, appOrigin, capabilityMatrix: [], drill: null, screenContext });
          }
        }
      })();
      return () => { alive = false; };
    }

    const block = { id: `panel-${screenPanel.screen}`, type: screenPanel.screen, config: { scope: 'all' } };
    materializeBlock({ block, circleId: circle?.id, hostOps: { callSkill: rawCallSkill, eventLog, circles, fetchImpl: getCirclePodFetch() || undefined } })
      .then((m) => { if (alive) setPanelBlocks([m]); })
      .catch(() => { if (alive) setPanelBlocks([]); });
    return () => { alive = false; };
  }, [screenPanel, circle?.id, rawCallSkill, eventLog, circles, policy, capabilitySources, overrideStore, manifestsByOrigin]);

  // A tapped bubble button: S6.B screen button (has screen) → open the panel;
  // S6.A inline manifest button (has opId) → dispatch its op against the item;
  // otherwise (B clarification candidate) → bind the id + re-run.
  const onBubbleButton = useCallback((button) => {
    if (button?.screen) { setScreenPanel({ screen: button.screen }); return; }
    if (button?.opId) {
      const op = catalog?.opsById?.get(button.opId)?.op;
      const arg = op?.surfaces?.slash?.match?.arg
        ?? (op?.params || []).find((p) => p?.pickerSource)?.name
        ?? 'id';
      runCircleCommandResolved({ opId: button.opId, args: button.itemId != null ? { [arg]: button.itemId } : {} });
      return;
    }
    if (button?.id) clarify.pick(button.id, { id: circle?.id });
  }, [clarify, circle?.id, catalog, runCircleCommandResolved]);

  // B (two-level LLM policy) — the member's PERSONAL default, consulted when the circle policy is
  // 'user'. Persisted via AsyncStorage; seeded from the configured route until a settings UI lands
  // (a stored preference always wins once set).
  const [userLlmDefault, setUserLlmDefault] = useState({ mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' });
  useEffect(() => {
    let alive = true;
    createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get()
      .then((v) => { if (alive && v && v.mode !== 'off') setUserLlmDefault(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // B (per-circle policy) — THIS circle's llmTool is authoritative (same cc.circlePolicy.<id> store the
  // settings screen writes). Unset → the deployment default CIRCLE_LLM_POLICY. Reloads per circle.
  const [circleLlmPolicy, setCircleLlmPolicy] = useState(CIRCLE_LLM_POLICY);
  // This circle's app scope for the LLM tool list (the S6.C per-circle apps). Empty → fall back to the
  // deployment env default (CIRCLE_LLM_APPS), else all apps. Per-circle so a household circle offers
  // household tools while a chores circle offers its own — not a blunt global switch.
  const [circleApps, setCircleApps] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!circle?.id) { setCircleLlmPolicy(CIRCLE_LLM_POLICY); setCircleApps([]); return undefined; }
    AsyncStorage.getItem(`cc.circlePolicy.${circle.id}`)
      .then((s) => {
        if (!alive) return;
        let raw = null;
        try { raw = s ? JSON.parse(s) : null; } catch { raw = null; }
        setCircleLlmPolicy(raw && typeof raw.llmTool === 'string' ? raw.llmTool : CIRCLE_LLM_POLICY);
        setCircleApps(Array.isArray(raw?.apps) ? raw.apps.filter((a) => typeof a === 'string' && a) : []);
      })
      .catch(() => { if (alive) { setCircleLlmPolicy(CIRCLE_LLM_POLICY); setCircleApps([]); } });
    return () => { alive = false; };
  }, [circle?.id]);
  // Per-circle apps win; deployment env is the fallback; neither → all apps (undefined → no scoping).
  const llmApps = circleApps.length ? circleApps : (CIRCLE_LLM_APPS.length ? CIRCLE_LLM_APPS : null);

  // B (circle bot) — the kring composer router: slash command → dispatch; free text addressed to the
  // bot (when the circle's LLM route is on) → interpret → dispatch; everything else → normal kring
  // post (fan-out the already-echoed message). Shared core with web (createCircleDispatch).
  // LLM + embed providers from the member's saved endpoint config (settings), falling back to the
  // EXPO_PUBLIC_* env. Shared with web via buildUserLlmRuntime (the confidential-route guard runs inside).
  // Rebuilds when userLlmDefault changes → a settings save live-applies (the bot useMemo depends on it).
  const llmRuntime = useMemo(() => {
    try {
      return buildUserLlmRuntime(userLlmDefault, { env: {
        mode: CIRCLE_LLM_BASEURL ? 'local' : 'off',
        llmBaseUrl: CIRCLE_LLM_BASEURL, llmModel: CIRCLE_LLM_MODEL,
        embedBaseUrl: CIRCLE_EMBED_BASEURL, embedModel: CIRCLE_EMBED_MODEL,
        timeoutMs: CIRCLE_LLM_TIMEOUT_MS,
      } });
    } catch { return { llmProviders: {}, embedProviders: {}, mode: 'off' }; }
  }, [userLlmDefault]);
  const hasEmbedProvider = !!(llmRuntime.embedProviders.local || llmRuntime.embedProviders.cloud);

  const circleBot = useMemo(() => createCircleDispatch({
    catalog,
    // Circle policy is authoritative (this circle's own llmTool); 'user' delegates to the member default.
    // `apps` scopes the LLM's tool list to the relevant app origins (was never passed → all 105 tools).
    // Per-circle (circle policy.apps) with the deployment env as fallback.
    policy: { llmTool: circleLlmPolicy, ...(llmApps ? { apps: llmApps } : {}) },
    userDefault: { mode: llmRuntime.mode },
    llmProviders: llmRuntime.llmProviders,
    interpret: interpretToCommand,
    // Conversation memory — the recent kring turns (latest via rowsRef), web parity.
    recentTurns: () => recentKringTurns({ rows: rowsRef.current, limit: 6 }),
    botName: CIRCLE_BOT_NAME,
    // Deterministic pre-LLM gate (manifest-derived via renderGate): "add X" / "done X" / "claim X"
    // route to the task op WITHOUT the (unreliable) small-model tool pick; else falls to interpret.
    // Gate built for the user's locale so trailing verbs ("kaas done"/"afwas klaar") match per-language.
    // F-retrieve (web parity): `makeCircleRetriever` auto-tiers — tier-2 SEMANTIC
    // when an embed route is configured (rides this circle's embed policy via
    // `resolveEmbed`), else tier-1 LEXICAL; an embedder error falls back to lexical.
    // Ranking lives once in circleRetriever; this shell injects the loadItems + embed adapters.
    gate: createTokenGate({
      rules: circleGateRules(lang()),
      retrieve: makeCircleRetriever({
        embed: hasEmbedProvider
          ? async (texts) => {
              const embedder = resolveCircleEmbedder({
                circlePolicy: { llmTool: circleLlmPolicy },
                userDefault:  { mode: llmRuntime.mode },
                providers:    llmRuntime.embedProviders,
              });
              if (!embedder) throw new Error('no-embedder');   // → graceful tier-1 lexical fallback
              return embedder.embed(texts);
            }
          : undefined,
        loadItems: (ctx) => loadCircleItems({ callSkill, circleId: ctx?.circleId ?? circle?.id }),
        // Persistence seam (vectorStore) — web parity. Threaded end-to-end into
        // PodSearch, which persists vectors under
        // private/state/search-index/circle-rag/<id>/ (never sharing/). Wires the
        // circle's available pseudo-pod StorageBackend; in-memory in the standalone
        // posture (live-pod dependency documented at circleSearchVectorStore).
        vectorStore: circleSearchVectorStore,
        scope: 'circle-rag',
      }),
    }),
    // A slash command is parsed to {opId,args}; the LLM already yields {opId,args}. Both then flow
    // through the clarifying dispatch (unique → run; ambiguous → ask with buttons).
    dispatch: (input) => {
      let cmd = input;
      if (typeof input === 'string') {
        const parsed = catalog ? parseInput(input, catalog) : null;
        cmd = parsed && parsed.kind === 'slash' && parsed.opId ? { opId: parsed.opId, args: parsed.args || {} } : null;
      }
      if (!cmd || !cmd.opId) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
      // E2 bulk fan-out ("/done all"): resolveDispatch flags it; run over the last listing, bypassing clarify.
      try {
        const r = resolveDispatch({ kind: 'slash', opId: cmd.opId, args: cmd.args || {} }, catalog);
        if (r && r.kind === 'bulk') return handleKringBulk(r);
      } catch { /* not bulk → normal path */ }
      return clarify.run(cmd, { id: circle?.id });
    },
    postToKring: (text, ctx) => { if (ctx?.msgId) broadcastFanOut({ msgId: ctx.msgId, text, ts: ctx.ts ?? Date.now() }); },
    // Addressed the bot, but the LLM mapped it to no tool → reply instead of going silent.
    onNoMatch: (_text, _ctx, opts) => { appendKringMessage({ actor: 'bot', text: (opts && opts.reply) || t('circle.bot.unknown') }); },
    // Smart chat off / unreachable → plain-language "basic mode" reply (contextual indicator, no badge).
    onLlmUnavailable: () => { appendKringMessage({ actor: 'bot', text: t('circle.bot.basic_mode') }); },
  }), [catalog, clarify, circle?.id, callSkill, appendKringMessage, broadcastFanOut, llmRuntime, hasEmbedProvider, circleLlmPolicy, llmApps, handleKringBulk]);

  // SP-13.2.1 / B / M6 — kring chat send: the feedback bot gets first refusal (it owns the turn only
  // for /feedback, /feedback-stop, and free text while active); otherwise echo + route to the circle bot.
  const sendKringChat = useCallback(async () => {
    const text = composerText.trim();
    if (!text || !eventLog?.append || !circle?.id) return;
    // B · Slice 3 — a slash command opens a declared list-screen (the CHAT entry; web≡mobile).
    const scr = text.match(/^\/(contacts|prikbord)\b/i);
    if (scr && sectionForScreen(manifestsByOrigin, scr[1].toLowerCase())) { setComposerText(''); setScreenPanel({ screen: scr[1].toLowerCase() }); return; }
    setComposerText('');
    // Conversational follow-up: the bot asked for a missing field (needsForm); THIS message is the answer.
    // Append it, complete the pending dispatch, and run it — don't route to feedback or re-interpret.
    if (pendingFollowUp) {
      const pending = pendingFollowUp;
      setPendingFollowUp(null);
      appendKringMessage({ actor: 'me', text });
      const ready = completeFollowUp({ pending, text });
      await runCircleCommandResolved({ opId: ready.opId, args: ready.args });
      return;
    }
    // Conversational follow-up: the bot just asked a free-text question (llm-reply '?'). Route THIS line
    // back to it — force-addressed so handle() interprets it (recent turns give it the context) — instead
    // of broadcasting it to the kring. So "which list?" → "shopping" continues the conversation, no tag.
    if (awaitingBotReply && !text.startsWith('/')) {
      const prev = awaitingBotReply;
      setAwaitingBotReply(null);
      const appended = appendKringMessage({ actor: 'me', text });
      const line = addressesBot(text, CIRCLE_BOT_NAME) ? text : `@${CIRCLE_BOT_NAME} ${text}`;
      // Thread the prior exchange so a bare answer resolves: [original ask] → [bot's question] → [answer].
      const history = [
        { role: 'user', content: prev.query },
        { role: 'assistant', content: prev.question },
      ].filter((m) => m.content);
      const r = await Promise.resolve(circleBot.handle(line, { id: circle.id, msgId: appended?.msgId, ts: appended?.ts, history })).catch(() => null);
      noteBotTurn(r, text);
      return;
    }
    // M6 — lazy shared feedback mount; its appendUserBubble/appendBotBubble render into the kring. Text
    // bubbles (incl. the bot's button labels); interactive M12 chips on mobile are a follow-up.
    if (!feedbackMountRef.current) {
      feedbackMountRef.current = createFeedbackMount({
        llmBaseURL: FEEDBACK_LLM_BASEURL,
        appendUserBubble: (_tid, t) => appendKringMessage({ actor: 'me', text: t }),
        appendBotBubble:  (_tid, t) => appendKringMessage({ actor: 'bot', text: t }),
      });
    }
    if (await feedbackMountRef.current.tryHandle(text, circle.id)) return;   // feedback owned the turn
    // A plain typed line fans out to the whole kring → scope 'kring' (web parity).
    const appended = appendKringMessage({ actor: 'me', text, scope: 'kring' });
    // Fire-and-forget: the bot posts its own reply bubble; swallow rejections so a failed turn can't
    // surface as an unhandled promise rejection. noteBotTurn arms the conversational follow-up if the
    // bot replied with a question.
    Promise.resolve(circleBot.handle(text, { id: circle.id, msgId: appended?.msgId, ts: appended?.ts })).then((r) => noteBotTurn(r, text)).catch(() => {});
  }, [composerText, eventLog, circle?.id, appendKringMessage, circleBot, pendingFollowUp, runCircleCommandResolved, awaitingBotReply, noteBotTurn, manifestsByOrigin]);

  // δ.2 — tap-to-retry on the failed icon.  Looks up the original
  // text from the eventLog so we don't have to remember it elsewhere.
  const onRetryDelivery = useCallback((msgId) => {
    if (!eventLog?.query) return;
    const evt = eventLog.query({ excludeMuted: true }).find((e) => e.id === msgId);
    const text = evt?.payload?.text;
    const ts   = evt?.ts ?? Date.now();
    if (typeof text !== 'string' || !text) return;
    broadcastFanOut({ msgId, text, ts });
  }, [eventLog, broadcastFanOut]);

  // Proof-of-Location: the passive placeholder row was removed 2026-06-25 (parked feature, board 10C /
  // slice 5.9d). The seam stays in the tree (src/v2/circlePol.js + getPolStatus + circle.pol.* locale) so
  // re-surfacing it later is just re-adding the row. See REMAINING-WORK.md "Proof-of-Location (parked)".

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.page} testID="circle-detail">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
        {/* SP-13.4 — Chat ↔ Scherm pill (v2 §4).
            React Native's accessibilityRole vocabulary doesn't include
            'group' (that's a web-only ARIA role).  The buttons inside
            carry their own role + accessibilityState; the wrapper just
            needs a label for screen-reader context. */}
        <View
          style={styles.viewToggle}
          accessibilityLabel={t('circle.kring.view_toggle_label')}
          testID="circle-detail-view-toggle"
        >
          {['chat', 'scherm'].map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === viewMode }}
              testID={`circle-detail-view-${mode}`}
              onPress={() => { if (mode !== viewMode) setViewMode(mode); }}
              style={[styles.viewToggleBtn, mode === viewMode && styles.viewToggleBtnActive]}
            >
              <Text style={[styles.viewToggleText, mode === viewMode && styles.viewToggleTextActive]}>
                {t(`circle.kring.view_${mode}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('circle.kring.more')}
          testID="circle-detail-more"
          onPress={() => setMenuOpen((v) => !v)}
          style={styles.moreBtn}
        >
          <Text style={styles.moreBtnText}>⋯</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{circle.name || circle.id}</Text>
      {circle.memberCount != null ? (
        <Text style={styles.tileMeta}>{t('circle.members', { count: circle.memberCount })}</Text>
      ) : null}

      {menuOpen ? (
        <View style={styles.moreMenu} testID="circle-detail-more-menu">
          {/* D / Surface 2 — the ⋯ menu items are PROJECTED from manifest.actions
              via the shared `circleActionsMobile` selector (platform + feature
              gated), NOT a hand-written list.  `back` is rendered in the header
              bar above (a nav affordance), so it's excluded here.  id → the
              host-wired handler; each shell wires its own mechanism for a
              destination (e.g. `contacts` → setScreenPanel here, openCircleScreenPanel
              on web — the doorgeefluik model).  web ≡ mobile by construction. */}
          {circleActionsMobile(canopyChatManifest, { policy })
            .filter((action) => action.id !== 'back')
            .map((action) => {
              const handlers = {
                invite: onInvite, settings: onSettings, lists: onLists,
                contacts: () => setScreenPanel({ screen: 'contacts' }),   // B · Slice 3 — filterable list-screen
                override: onMine, viewAs: onViewAs, advisor: onAdvisor, skills: onSkills,
                files: onFiles, rules: onRules, recipes: onRecipes, admin: onAdmin, share: onShare,
              };
              const on = handlers[action.id];
              const token = { override: 'mine', viewAs: 'viewas' }[action.id] ?? action.id;
              return (
                <Pressable
                  key={action.id}
                  onPress={() => { setMenuOpen(false); on?.(); }}
                  style={styles.moreItem}
                  testID={`circle-detail-${token}`}
                >
                  <Text style={styles.moreItemText}>{t(action.labelKey)}</Text>
                </Pressable>
              );
            })}
        </View>
      ) : null}

      {/* Proof-of-Location row removed 2026-06-25 (parked — see REMAINING-WORK.md). */}
      {myListTasks.length > 0 ? (
        <View style={styles.onYourList} testID="circle-detail-on-your-list">
          <Text style={styles.onYourListTitle}>{t('circle.on_your_list')}</Text>
          {myListTasks.map((task) => (
            <View key={task.id} style={styles.onYourListRow}>
              <Text style={styles.onYourListText} numberOfLines={2}>
                {task.text || task.title || task.label || String(task.id ?? '')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* SP-13.3 — body switches by active tab.  GESPREK = chat-style
          mixed stream; other tabs are placeholders until their content
          surfaces land in follow-up slices.
          SP-13.4 — scherm-mode wins over the tab body: the whole pane
          becomes the (placeholder) recept'd page. */}
      <ScrollView contentContainerStyle={styles.list} testID="circle-detail-stream">
        {viewMode === 'scherm' ? (
          // α.1e — render the materialized recipe blocks.  CircleScreenView
          // handles per-block status (ok / empty / error) + top-level
          // empty-state when no recipe is set up yet.
          <CircleScreenView blocks={screenBlocks} onAction={onScreenAction}
            onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
        ) : activeTab === 'prikbord' ? (
          // S1 #1 — the buurt noticeboard (its own composer + post list), scoped to
          // the open circle (S4 per-circle restructure — see stoopCall above).
          <CircleNoticeboard callSkill={stoopCall} onStoopEvent={onStoopEvent} media={circleMedia}
            onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
        ) : activeTab === 'leden' ? (
          // LEDEN — the circle's member roster (listGroupMembers → normalizeCircleMembers). web≡mobile.
          tabMembers == null ? (
            <Text style={styles.placeholder}>{t('circle.leden_tab.loading')}</Text>
          ) : tabMembers.length === 0 ? (
            <Text style={styles.placeholder}>{t('circle.leden_tab.empty')}</Text>
          ) : (
            tabMembers.map((m) => (
              <View key={m.id} style={styles.memberRow} testID="circle-member-row">
                <Text style={styles.memberHandle} numberOfLines={1}>{m.handle ? `@${m.handle}` : (m.realName || m.id)}</Text>
                {m.realName && m.handle ? <Text style={styles.memberName} numberOfLines={1}>{m.realName}</Text> : null}
              </View>
            ))
          )
        ) : activeTab !== 'gesprek' ? (
          <Text style={styles.placeholder}>
            {t('circle.kring.tab_coming', { tab: t(`circle.tabs.${activeTab}`) })}
          </Text>
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>{t('circle.kring.empty')}</Text>
        ) : (
          renderBubblesWithDayDividers(rows, t, {
            deliveryStateFor,
            localActor: 'me',
            onRetryDelivery,
            onBubbleButton,
            // tap a "See also" embed chip → open the item's screen panel (S6.B).
            onEmbedOpen: ({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); },
          })
        )}
      </ScrollView>

      {/* S6.B — chat-triggered screen panel (tasks/agenda overview) in a modal. */}
      <Modal visible={!!screenPanel} animationType="slide" transparent onRequestClose={() => setScreenPanel(null)}>
        <View style={styles.panelBackdrop}>
          <View style={styles.panelCard} testID="circle-screen-panel">
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>
                {screenPanel ? t(`circle.screen.open.${screenPanel.screen}`, { defaultValue: t('circle.screen.open_generic') }) : ''}
              </Text>
              <Pressable onPress={() => setScreenPanel(null)} testID="circle-screen-panel-close">
                <Text style={styles.panelClose}>✕</Text>
              </Pressable>
            </View>
            {listScreenData?.shape === 'record' ? (
              /* Q17 — a record-shaped DETAIL screen (read-only key→value, web parity). */
              <ScrollView>
                <CircleRecordScreen record={listScreenData.record} />
              </ScrollView>
            ) : listScreenData ? (
              /* B · Slice 3 — the interactive list-screen (owns its own scroll + search). */
              <CircleListScreen
                items={listScreenData.items}
                categoryField={listScreenData.categoryField}
                searchFields={listScreenData.searchFields}
                labelField={listScreenData.labelField}
                manifestsByOrigin={manifestsByOrigin}
                appOrigin={listScreenData.appOrigin}
                capabilityMatrix={listScreenData.capabilityMatrix}
                onRowAction={({ opId, itemId }) => { setScreenPanel(null); runCircleCommandResolved({ opId, args: { id: itemId } }); }}
                onRowOpen={listScreenData.drill
                  /* Q15 — picking a row opens the sibling DETAIL panel with the
                     selection context materialized from the picked row (shared
                     selectionContextFor; web parity with openCircleScreenPanel). */
                  ? ({ item }) => setScreenPanel({
                      screen: listScreenData.drill.screenId,
                      context: selectionContextFor(listScreenData.drill, item, listScreenData.screenContext),
                    })
                  : undefined}
              />
            ) : (
              <ScrollView ref={panelScrollRef}>
                <View ref={panelContentRef} collapsable={false}>
                  <CircleScreenView blocks={panelBlocks} highlightRef={screenPanel?.highlightRef}
                    highlightRowRef={highlightRowRef} onHighlightLayout={scrollPanelToHighlight}
                    onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 2+-field needsForm → an inline labelled form above the composer (parity with web). */}
      {pendingForm && viewMode !== 'scherm' && activeTab === 'gesprek' ? (
        <MultiFieldFormBubble pending={pendingForm} onSubmit={onFormSubmit} />
      ) : null}

      {/* SP-13.2 — inline composer.  V0 appends a chat-message event to
          the local EventLog so the user sees their own write; peer
          broadcast lands in SP-13.2.1.  Slash commands stay as a
          deeper follow-up (would need the chat-shell composition).
          SP-13.4 — composer suppressed in scherm-mode (recept page is
          not a chat surface). */}
      {/* S1 #1 — the noticeboard (prikbord) tab owns its own composer. */}
      {viewMode !== 'scherm' && activeTab === 'prikbord' ? null
      : viewMode !== 'scherm' && !canPost ? (
        /* Permission gate — chat disabled for this circle; read-only note in place of the composer. */
        <Text style={styles.composerDisabled} testID="circle-detail-composer-disabled">
          {t('circle.kring.chat_disabled')}
        </Text>
      ) : viewMode !== 'scherm' ? (
      <>
        {/* Slash-command auto-suggest — sits above the composer, mirrors the web dropdown. Tap a row
            to fill the command + a trailing space (then keep typing args). Hidden when there's no
            "/command" prefix match (suggestCommands closes once a space is typed). */}
        {suggestMatches.length > 0 ? (
          <View style={styles.suggest} testID="circle-detail-suggest">
            {suggestMatches.map((m) => (
              <Pressable
                key={m.command}
                style={styles.suggestItem}
                accessibilityRole="button"
                testID={`circle-detail-suggest-${m.opId}`}
                onPress={() => setComposerText(`${m.command} `)}
              >
                <Text style={styles.suggestCmd}>{m.command}</Text>
                {m.hint ? <Text style={styles.suggestHint} numberOfLines={1}>{m.hint}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.composer} testID="circle-detail-composer">
          <TextInput
            style={styles.composerInput}
            value={composerText}
            onChangeText={setComposerText}
            placeholder={t('circle.kring.composer_placeholder')}
            accessibilityLabel={t('circle.kring.composer_placeholder')}
            returnKeyType="send"
            onSubmitEditing={sendKringChat}
          />
          <Pressable
            style={styles.composerSend}
            accessibilityRole="button"
            accessibilityLabel={t('circle.kring.send')}
            testID="circle-detail-composer-send"
            onPress={sendKringChat}
          >
            <Text style={styles.composerSendText}>↑</Text>
          </Pressable>
        </View>
      </>
      ) : null}

      {/* SP-13.3 — per-kring bottom tab bar (derived from policy.features).
          Only renders when there are ≥ 2 tabs (a single-tab kring has
          nothing to switch between).
          SP-13.4 — also suppress in scherm-mode. */}
      {tabs.length >= 2 && viewMode !== 'scherm' ? (
        <View style={styles.kringTabs} testID="circle-detail-tabs">
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              testID={`circle-detail-tab-${tab.id}`}
              onPress={() => {
                if (tab.id === activeTab) return;
                setActiveTab(tab.id);
                // D1 — count tab use so the Veel-gebruikt row reflects reality.
                const f = featureForTabId(tab.id);
                if (f && circle?.id) actionFrequency.bump(circle.id, f);
              }}
              style={[styles.kringTab, tab.id === activeTab && styles.kringTabActive]}
            >
              <Text style={[styles.kringTabText, tab.id === activeTab && styles.kringTabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// SP-13.2 — render rows chronologically with day-dividers, mirroring
// the web circleKring renderer.  Keeps the mobile parity tight.
// δ.2 — `deliveryOpts` carries the per-message delivery-state hooks
// for locally-sent bubbles (clock / warning + tap-to-retry).
function renderBubblesWithDayDividers(rows, t, deliveryOpts = null) {
  const chronological = [...rows].reverse();
  const nodes = [];
  let lastKey = null;
  for (const row of chronological) {
    const key = dayKeyOf(row.ts);
    if (key !== lastKey) {
      nodes.push(
        <Text key={`d-${row.id}`} style={styles.dayDivider}>
          {formatDayLabel(row.ts, t)}
        </Text>,
      );
      lastKey = key;
    }
    nodes.push(renderBubble(row, t, deliveryOpts));
  }
  return nodes;
}

function renderBubble(row, t, deliveryOpts = null) {
  const payload = row.event?.payload ?? {};
  const text = payload.text || payload.title || payload.body || String(row.id ?? '');
  const sender = payload.senderDisplay || payload.authorName || row.actor || null;
  const kindRaw = payload.kind;
  const kind = (typeof kindRaw === 'string' && kindRaw && kindRaw !== 'message' && kindRaw !== 'chat-message')
    ? kindRaw.toUpperCase() : null;
  const actions = actionsForStreamRow(row);
  // B (clarification) — per-message candidate buttons carried in the payload (e.g. "which item?").
  const msgButtons = Array.isArray(payload.buttons) ? payload.buttons : [];
  const onBubbleButton = typeof deliveryOpts?.onBubbleButton === 'function' ? deliveryOpts.onBubbleButton : null;
  // δ.2 — delivery-state icon for locally-sent chat messages only.
  // Mirrors web circleKring renderer's gate.
  const deliveryStateFor = typeof deliveryOpts?.deliveryStateFor === 'function'
    ? deliveryOpts.deliveryStateFor : null;
  const localActor      = deliveryOpts?.localActor ?? null;
  const onRetryDelivery = typeof deliveryOpts?.onRetryDelivery === 'function'
    ? deliveryOpts.onRetryDelivery : null;
  const isLocalChat = deliveryStateFor != null
    && localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message');
  const deliveryState = isLocalChat ? deliveryStateFor(row.id) : null;
  return (
    <View key={row.id} style={styles.bubble} testID={`kring-bubble-${row.id}`}>
      {sender ? <Text style={styles.bubbleSender}>{sender}</Text> : null}
      {/* "only you" vs "whole kring" scope badge — one presentation of payload.scope. */}
      {payload.kind === 'chat-message' ? (
        <Text
          style={[styles.bubbleScope, payload.scope === 'kring' ? styles.bubbleScopeKring : styles.bubbleScopeSelf]}
          testID={`kring-scope-${payload.scope === 'kring' ? 'kring' : 'self'}-${row.id}`}
        >
          {payload.scope === 'kring' ? `👥 ${t('circle.scope.kring')}` : `👤 ${t('circle.scope.self')}`}
        </Text>
      ) : null}
      <Text style={styles.bubbleText} numberOfLines={4}>
        {kind ? (<Text style={styles.bubbleKind}>{kind}  </Text>) : null}
        {text}
      </Text>
      {embedChipsOf(payload).length > 0 ? (
        <View style={styles.bubbleEmbeds}>
          {embedChipsOf(payload).map((e) => {
            const typeKey = embedTypeLabelKey(e.type);
            const typeLabel = t(typeKey);
            const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
            const screen = screenForEmbedType(e.type);
            const onEmbedOpen = deliveryOpts?.onEmbedOpen;
            const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
            const label = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
            return tappable ? (
              <Pressable key={e.ref} style={styles.bubbleEmbed} testID={`kring-embed-${e.ref}`}
                onPress={() => onEmbedOpen({ type: e.type, ref: e.ref, screen })}>
                <Text style={styles.bubbleEmbedText}>{label}</Text>
              </Pressable>
            ) : (
              <View key={e.ref} style={styles.bubbleEmbed} testID={`kring-embed-${e.ref}`}>
                <Text style={styles.bubbleEmbedText}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actions.map((a) => (
            <Pressable
              key={a.id}
              style={styles.rowActionBtn}
              onPress={() => console.info('[kring] action', a.action, row.id)}
            >
              <Text style={styles.rowActionText}>{t(a.label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {msgButtons.length > 0 ? (
        <View style={styles.rowActions}>
          {msgButtons.map((b) => (
            <Pressable
              key={b.id}
              style={styles.rowActionBtn}
              accessibilityRole="button"
              testID={`kring-msgbtn-${b.id}`}
              onPress={() => { if (onBubbleButton) onBubbleButton(b); }}
            >
              <Text style={styles.rowActionText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {deliveryState === 'pending' ? (
        <Text
          style={styles.deliveryPending}
          accessibilityLabel={t('circle.chat.delivery.pending')}
          accessibilityRole="text"
          testID={`kring-delivery-pending-${row.id}`}
        >
          ⏱ {t('circle.chat.delivery.pending')}
        </Text>
      ) : null}
      {deliveryState === 'failed' ? (
        <Pressable
          style={styles.deliveryFailed}
          accessibilityRole="button"
          accessibilityLabel={t('circle.chat.delivery.failed')}
          testID={`kring-delivery-failed-${row.id}`}
          onPress={() => { if (onRetryDelivery) onRetryDelivery(row.id); }}
        >
          <Text style={styles.deliveryFailedText}>
            ⚠ {t('circle.chat.delivery.failed')}
          </Text>
        </Pressable>
      ) : null}
      {deliveryState === 'undeliverable' ? (
        // permanent (e.g. a member has no published key) — show it, but NO retry.
        // A static Text, not a Pressable (retrying can't help).
        <Text
          style={styles.deliveryUndeliverable}
          accessibilityLabel={t('circle.chat.delivery.undeliverable')}
          accessibilityRole="text"
          testID={`kring-delivery-undeliverable-${row.id}`}
        >
          ⊘ {t('circle.chat.delivery.undeliverable')}
        </Text>
      ) : null}
    </View>
  );
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function formatDayLabel(ts, t) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  if (sameDay) return t('circle.kring.day_today');
  if (isYest)  return t('circle.kring.day_yesterday');
  return d.toLocaleDateString();
}

// P6.8 #346 — Nearby/HIER screen.  Renders the buildNearbyModel output:
// peer rows with shared-skills + proximity, header line, and an own-profile
// footer.  Self-contained so vitest can target it without RN test renderer.
function NearbyScreen({ model, onBack }) {
  const rows       = Array.isArray(model?.rows) ? model.rows : [];
  const own        = model?.ownProfile ?? {};
  const headerText = model?.headerLabel ?? '';
  return (
    <View style={styles.page} testID="circle-nearby-screen">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-nearby-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.nearbyScreen.title')}</Text>
      <Text style={styles.muted}>{headerText}</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.nearbyScreen.header_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <View
              key={row.id || row.pseudonym}
              style={styles.row}
              testID={`nearby-row-${row.id || row.pseudonym}`}
            >
              <Text style={styles.rowName}>{row.pseudonym}</Text>
              {row.sharedSkills.length ? (
                <Text style={styles.rowMeta}>{row.sharedSkills.join(', ')}</Text>
              ) : null}
              {row.proximity ? <Text style={styles.rowMeta}>{row.proximity}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.ownProfile}>
        <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.own_profile')}</Text>
        <Text style={styles.muted}>
          {Array.isArray(own.publishedSkills) && own.publishedSkills.length
            ? own.publishedSkills.join(', ')
            : t('circle.nearbyScreen.own_profile_empty')}
        </Text>
      </View>
    </View>
  );
}

// P6.M7 #349 — Mijn dingen notes-list (board 10A): the Folio screen
// scoped to the private kring.  Empty state by default; rows fill in
// when callSkill('listFiles') returns mine-and-circle-less items.
function MyThingsScreen({ files = [], onBack }) {
  return (
    <View style={styles.page} testID="circle-mythings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-mythings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.folio.my_things_title')}</Text>
      {files.length === 0 ? (
        <Text style={styles.muted}>{t('circle.folio.my_things_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {files.map((file) => (
            <View key={file.id} style={styles.row} testID={`mythings-row-${file.id}`}>
              <Text style={styles.rowName}>{file.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // S6.B — chat-triggered screen panel.
  panelBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  panelCard:  { backgroundColor: theme.color.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', minHeight: '50%', padding: 16 },
  panelHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  panelTitle: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  panelClose: { fontSize: 16, color: theme.color.inkSoft, paddingHorizontal: 6 },
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  back:       { fontSize: 13, color: theme.color.inkSoft },
  barActions: { flexDirection: 'row', gap: 14, marginLeft: 'auto' },
  availText:  { fontSize: 13, color: theme.color.inkSoft, fontWeight: '600' },
  detailActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 },
  // 5.9c — passive Nearby row at the top of the kringen list.
  nearbyRow:       { paddingHorizontal: 2, paddingVertical: 6, marginBottom: 2 },
  nearbyText:      { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  // 5.9d — passive Proof-of-Location row (placeholder; not tappable).
  polRow:          { flexDirection: 'row', gap: 6, alignItems: 'baseline', marginTop: 4, marginBottom: 8, paddingHorizontal: 2 },
  polLabel:        { fontSize: 12, color: theme.color.inkSoft, fontWeight: '600' },
  polValue:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  detailAction:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  detailActionText: { fontSize: 12, color: theme.color.inkSoft },
  title:      { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:       { gap: 6, paddingBottom: 32 },
  // β.3 — per-kind grouping in the launcher (small-caps muted header,
  // matches the web `.circle-launcher__section-title` look).
  section:        { marginTop: 10, gap: 6 },
  sectionTitle:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, color: theme.color.inkSoft, marginBottom: 4, paddingHorizontal: 2 },
  tile:       { padding: 13, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', alignItems: 'center', gap: 10, position: 'relative' },
  // β.5 — pinned tile gets the accent border + the 📌 indicator in the
  // top-right corner so users see "this floated to the top on purpose".
  tilePinned:        { borderColor: theme.color.accent },
  tilePinIndicator:  { position: 'absolute', top: 4, right: 8, fontSize: 11, opacity: 0.7 },
  tileBody:   { flex: 1, minWidth: 0 },
  tileName:   { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  tileMeta:   { fontSize: 11, color: theme.color.inkSoft, marginTop: 2 },
  // P6.3 — unread badge on the tile (board 5A).
  tileUnread: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  tileUnreadText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // P6.2 #341 — pending voorstellen badge (uses a yellow-ish hint to
  // separate it visually from the unread-red).
  tileProposals: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: '#d8a64a',
    alignItems: 'center', justifyContent: 'center',
  },
  tileProposalsText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // Launcher shortcut button row (Nearby, Mijn dingen).
  shortcut:     { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 16, backgroundColor: theme.color.card, marginBottom: 6, alignSelf: 'flex-start' },
  shortcutText: { fontSize: 13, color: theme.color.ink },
  muted:      { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  newBtn:     { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, borderRadius: 8, alignItems: 'center' },
  newText:    { color: theme.color.inkSoft },
  joinBtn:    { marginTop: 8, padding: 12, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, alignItems: 'center' },
  joinText:   { color: theme.color.accent, fontWeight: '600' },
  inviteBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  inviteCard: { backgroundColor: theme.color.paper, borderRadius: 14, padding: 20, alignItems: 'center', maxWidth: 320 },
  inviteTitle:{ fontSize: 16, fontWeight: '700', color: theme.color.ink, marginBottom: 12 },
  inviteHint: { fontSize: 13, color: theme.color.inkSoft, marginTop: 10, textAlign: 'center' },
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  createBtnText: { color: theme.color.white, fontSize: 16, fontWeight: '700' },
  // Shared row styles used by NearbyScreen + MyThingsScreen + SP-13 kring stream.
  row:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, marginBottom: 6 },
  rowName:    { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  rowMeta:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  // SP-13 — header overflow `⋯` trigger + collapsible menu.
  moreBtn:        { paddingHorizontal: 10, paddingVertical: 4 },
  moreBtnText:    { fontSize: 22, color: theme.color.inkSoft, lineHeight: 24 },
  moreMenu:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, padding: 4, marginTop: 4, marginBottom: 4 },
  moreItem:       { paddingVertical: 9, paddingHorizontal: 12 },
  moreItemText:   { fontSize: 13, color: theme.color.ink },
  // SP-13.2 — chat bubbles + composer (v2 §1+§5).
  bubble:           { padding: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card, marginBottom: 6, maxWidth: '85%', alignSelf: 'flex-start' },
  bubbleSender:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  bubbleScope:      { alignSelf: 'flex-start', fontSize: 10, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9, marginBottom: 3, overflow: 'hidden' },
  bubbleScopeSelf:  { backgroundColor: theme.color.paper, color: theme.color.inkSoft },
  bubbleScopeKring: { backgroundColor: '#e8eef6', color: '#3b6ea5' },
  bubbleText:       { fontSize: 14, color: theme.color.ink },
  bubbleKind:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: theme.color.accent },
  // embeds[] — cross-object "See also" chips on a kring message.
  bubbleEmbeds:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  bubbleEmbed:      { borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  bubbleEmbedText:  { fontSize: 12, color: theme.color.ink },
  dayDivider:       { alignSelf: 'center', fontSize: 11, color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 8 },
  composer:         { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  composerInput:    { flex: 1, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 22, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink },
  composerSend:     { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  composerSendText: { color: theme.color.white, fontSize: 18, fontWeight: '700' },
  // Slash-command auto-suggest list above the composer (web↔mobile parity with the classic dropdown).
  suggest:          { borderWidth: 1, borderColor: theme.color.line, borderRadius: 12, backgroundColor: theme.color.card, paddingVertical: 4, marginBottom: 6 },
  suggestItem:      { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 6, paddingHorizontal: 12 },
  suggestCmd:       { fontFamily: theme.font?.mono ?? undefined, color: theme.color.accent, fontWeight: '600', fontSize: 13 },
  suggestHint:      { color: theme.color.inkSoft, fontSize: 12, flexShrink: 1 },
  // Permission gate — read-only note shown when the circle's chat feature is off.
  composerDisabled: { paddingTop: 12, paddingBottom: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: theme.color.line, color: theme.color.inkSoft, fontSize: 13, fontStyle: 'italic', textAlign: 'center' },
  // SP-13.3 — per-kring bottom tab bar + tab-coming placeholder.
  kringTabs:        { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  kringTab:         { flex: 1, paddingVertical: 12, alignItems: 'center', borderTopWidth: 2, borderTopColor: 'transparent', marginTop: -1 },
  kringTabActive:   { borderTopColor: theme.color.accent },
  kringTabText:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.4 },
  kringTabTextActive:{ color: theme.color.accentInk, fontWeight: '600' },
  // SP-13.4 — Chat ↔ Scherm header pill.
  viewToggle:          { flexDirection: 'row', borderWidth: 1, borderColor: theme.color.line, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.color.paper, marginLeft: 'auto', marginRight: 8 },
  viewToggleBtn:       { paddingHorizontal: 12, paddingVertical: 5 },
  viewToggleBtnActive: { backgroundColor: theme.color.accent },
  viewToggleText:      { fontSize: 12, color: theme.color.inkSoft },
  viewToggleTextActive:{ color: theme.color.white, fontWeight: '600' },
  placeholder:      { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  memberRow:        { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  memberHandle:     { fontSize: 15, color: theme.color.ink, fontWeight: '600' },
  memberName:       { fontSize: 13, color: theme.color.inkSoft, marginTop: 1 },
  // Per-row action buttons (Ik help / Negeer …) — used by chat bubbles.
  rowActions:     { flexDirection: 'row', gap: 6, marginTop: 8 },
  rowActionBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.paper },
  rowActionText:  { fontSize: 12, color: theme.color.ink },
  // δ.2 — per-message delivery state.  Pending = subtle clock-line,
  // Failed = warning pill (tap-to-retry).  Sent renders nothing.
  deliveryPending:    { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  deliveryFailed:     { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#f2c8b8', backgroundColor: '#fbe9e3' },
  deliveryFailedText: { fontSize: 11, color: '#b8290f' },
  deliveryUndeliverable: { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  ownProfile: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  ownProfileTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  // P6.5 #342 — "ON YOUR LIST" section on CircleDetail.
  onYourList:       { marginTop: 8, paddingHorizontal: 2, paddingVertical: 8 },
  onYourListTitle:  { fontSize: 11, letterSpacing: 1.0, color: theme.color.inkSoft, textTransform: 'uppercase', marginBottom: 6 },
  onYourListRow:    { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  onYourListText:   { fontSize: 13, color: theme.color.ink },
  // β.5 — per-tile context menu (Modal-backed sheet).  Backdrop catches
  // outside-tap to dismiss; sheet hugs the bottom for thumb reach.
  tileMenuBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  tileMenuSheet:     { backgroundColor: theme.color.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 8, paddingBottom: 20 },
  tileMenuItem:      { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8 },
  tileMenuItemText:  { fontSize: 15, color: theme.color.ink },
});
