/**
 * canopy-chat v2 — circle app boot (DEFAULT web entry, `index.html`).
 *
 * The v2 circle app is now the landing page; the classic chat shell is
 * kept reachable at `classic.html` (linked from the header). Reuses the
 * same bundled agent factory + shared circle model. Opening a circle
 * sets the active circle (F1) and shows a scoped detail; "+ new circle"
 * creates one via the existing createGroupV2 path and refreshes.
 *
 * ⚠ Needs a browser check: agent boot, live circle data, and create are
 * not unit-verifiable here (renderer/model/scope/content/create logic
 * are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { EventLog } from '../../src/eventLog.js';
import {
  buildCircleStream, buildKringStream,
} from '../../src/v2/circleStream.js';
import { isFeatureEnabled } from '../../src/v2/circlePolicy.js';
import { buildKringTabs, DEFAULT_KRING_TAB } from '../../src/v2/kringTabs.js';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';
import { rehydrateKringChatsFromStoop } from '../../src/v2/kringChatRehydrate.js';
import {
  createKringRecipeStore, localStorageRecipeIo, getActiveRecipe,
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
} from '../../src/v2/kringRecipe.js';
import { materializeRecipe } from '../../src/v2/kringRecipeBlocks.js';
import { renderCircleKring } from './circleKring.js';
import { renderCircleScreen } from './circleScreen.js';
import { renderRecipeEditor } from './circleRecipeEditor.js';
import { computeAdvice, makeTooBusyEvent } from '../../src/v2/circleAdvisor.js';
import { normalizeHopMode } from '../../src/v2/circleHop.js';
import { mergeSkill, normalizeSkill } from '../../src/v2/circleSkills.js';
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
import { normalizeRulesDoc } from '../../src/v2/circleRules.js';
import { renderRulesEditor } from './circleRulesEditor.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { normalizeCircleMembers } from '../../src/v2/circleMembers.js';
import { mergeCirclePolicy, mergeMemberOverride } from '../../src/v2/circlePolicy.js';
import { makeProposal, pendingApprovers } from '../../src/v2/circleConsensus.js';
import { createProposalStore, localStorageProposalIo } from '../../src/v2/circleProposalStore.js';
// P6.10 #348 — agent-add admin approval store (board 4B).
import { createAgentRequestStore } from '../../src/v2/agentRequest.js';
import { buildTilePreviews, bumpSeenAt } from '../../src/v2/circleTilePreviews.js';
import { makeAfterClaimHook } from '../../src/v2/claimRouter.js';
import { mergeAvailability } from '../../src/v2/memberAvailability.js';
import { createAvailabilityStore, localStorageAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { renderCircleAvailability } from './circleAvailability.js';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
import { renderCircleViewAs } from './circleViewAs.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleTabBar, hideCircleTabBar } from './circleTabBar.js';
import { renderCircleSettings } from './circleSettings.js';
import { renderCircleOverride } from './circleOverride.js';

// SP-13.2 — actor label stamped on local chat-message events.  Real WebID/
// peer-display wiring lands with peer broadcast (SP-13.2.1).
const LOCAL_ACTOR = 'me';

// SP-13.2.1 — best-effort NKN bootstrap.  Mirrors web/main.js's
// `connectPeerImpl` but doesn't throw if the CDN failed to load —
// the kring view still works locally (just no peer fan-out).
async function tryConnectPeerTransport(agent, peerMessageRouter) {
  const nknLib =
       (typeof window !== 'undefined' && window.nkn)
    ?? (typeof globalThis !== 'undefined' && globalThis.nkn)
    ?? null;
  if (!nknLib) {
    console.info('[circleApp] nkn-sdk not loaded — kring chat is local-only this session');
    return;
  }
  if (typeof agent?.connectPeerTransport !== 'function') {
    console.info('[circleApp] agent has no connectPeerTransport — kring chat is local-only');
    return;
  }
  try {
    await agent.connectPeerTransport({ nknLib, onPeerMessage: peerMessageRouter });
    console.info('[circleApp] NKN peer transport connected');
  } catch (err) {
    console.warn('[circleApp] NKN connect failed — kring chat is local-only:', err?.message ?? err);
  }
}

const policyStore = createCirclePolicyStore(localStoragePolicyIo());
// α.1c — per-kring recipe book store (multi-recipe per kring, one active).
// localStorage now; pod io can swap in later without touching callers.
const recipeStore = createKringRecipeStore({ io: localStorageRecipeIo() });
const overrideStore = createMemberOverrideStore(localStorageOverrideIo());
const availabilityStore = createAvailabilityStore(localStorageAvailabilityIo());
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

let rootEl = null;
let tabBarEl = null;
let circlesCache = [];
let sources = {};
let resolveCallSkill = null; // (opId, args) => Promise<object|null>
let rawCallSkill = null;     // (appOrigin, opId, args) — for createGroupV2

// Top-level tab bar (Kringen / Stroom / Mij). Shown on the three top-level
// surfaces; hidden inside a circle + its sub-screens.
function showTabBar(active) {
  renderCircleTabBar(tabBarEl, {
    active, t,
    onKringen: showLauncher,
    onStroom: showStream,
    onMij: showMij,
  });
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
// for that kring.  Default = 'chat' (v2 §4 — chat is the home view).
const VIEW_MODE_KEY = 'cc.circleViewMode';
function readViewMode(id) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map?.[id] === 'scherm' ? 'scherm' : 'chat';
  } catch { return 'chat'; }
}
function writeViewMode(id, mode) {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[id] = mode;
    window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(map));
  } catch { /* quota / disabled */ }
}

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  // P6.3 — project the EventLog into per-circle previews; tiles show a
  // chat-style subtitle + unread badge when there's recent activity.
  const previews = buildTilePreviews({
    events:  eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
    seenAt:  readSeenAt(),
  });
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    previews,
    proposals: launcherProposals,
    t,
    onOpenCircle: showDetail,
    onNewCircle: createCircle,
    onNearby: showNearby,
    onMyThings: showMyThings,
  });
  showTabBar('kringen');
  // Refresh proposal counts in the background so the next launcher
  // render shows yellow badges where consensus is waiting.  Async so
  // the first paint isn't blocked.
  refreshLauncherProposals().catch(() => { /* ignore */ });
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

function showStream() {
  const rows = buildCircleStream({
    events: eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
  });
  // Top-level tab screen — no back link (the Kringen tab is the way back).
  renderCircleStream(rootEl, { rows, t, onOpenCircle: showDetail });
  showTabBar('stroom');
}

// "Mij" tab — personal availability (holiday + quiet hours, board 6C) plus
// the device-global Hopping stance.
async function showMij() {
  let working = await availabilityStore.get();
  // Top-level tab screen — no back link (the Kringen tab is the way back);
  // Save still returns to the launcher.
  const rerender = () => renderCircleAvailability(rootEl, {
    availability: working,
    t,
    onChange: (patch) => { working = mergeAvailability(working, patch); rerender(); },
    onSave: async () => { await availabilityStore.update(working); showLauncher(); },
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
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
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
  const allowRules   = isFeatureEnabled(policy, 'houseRules');
  const allowViewAs  = isFeatureEnabled(policy, 'memberDirectory');
  const allowFiles   = isFeatureEnabled(policy, 'lists') || isFeatureEnabled(policy, 'notes');
  const more = {
    settings: () => showSettings(id),
    mine:     () => showOverride(id),
    advisor:  () => showAdvisor(id),
    skills:   () => showSkills(id),
    // α.1d — recipe editor (scherm-mode page composition).  Available
    // to everyone for V0; admin-gating + multi-admin consensus are
    // follow-up slices.
    recipes:  () => showRecipeEditor(id),
    ...(allowViewAs ? { viewAs: () => showViewAs(id) } : {}),
    ...(allowFiles  ? { files:  () => showFolio(id) } : {}),
    ...(allowRules  ? { rules:  () => showRules(id) } : {}),
  };
  // SP-13.3 — per-kring bottom tabs derived from policy.features.
  const tabs = buildKringTabs(policy, t);
  let activeTab = DEFAULT_KRING_TAB;
  // SP-13.4 — Chat ↔ Scherm pill state, persisted per circle.
  let viewMode = readViewMode(id);
  // α.1c — materialized scherm blocks (recipe book → blocks).  Null
  // until the async load below resolves; replaces SP-13.4's
  // "scherm_coming" placeholder when present.
  let screenBlocks = null;
  let seq = 0;
  const rerender = () => {
    const rows = buildKringStream({
      events:    eventLog.query({ excludeMuted: true }),
      circles:   circlesCache,
      circleId:  id,
    });
    renderCircleKring(rootEl, {
      circle, rows, t,
      tabs, activeTab,
      viewMode,
      screenBlocks,
      onViewMode: (mode) => {
        if (mode !== 'chat' && mode !== 'scherm') return;
        viewMode = mode;
        writeViewMode(id, mode);
        rerender();
      },
      onTab: (tabId) => { activeTab = tabId; rerender(); },
      onBack:   showLauncher,
      onSend:   (text) => {
        // SP-13.2 / SP-13.2.1 — optimistic local append + best-effort
        // peer fan-out.  The msgId is shared so receiver-side dedup
        // suppresses any echo if a peer's pseudo-pod re-mirrors.
        const msgId = `kring-${id}-${Date.now()}-${(seq += 1).toString(36)}`;
        const ts    = Date.now();
        eventLog.append({
          id:    msgId,
          ts,
          app:   'kring',
          type:  'chat-message',
          actor: LOCAL_ACTOR,
          payload: { circleId: id, text, kind: 'chat-message' },
        });
        rerender();
        if (typeof rawCallSkill === 'function') {
          rawCallSkill('stoop', 'broadcastKringMessage', {
            groupId: id, text, msgId, ts,
          }).then((r) => {
            if (r?.error) console.warn('[kring-chat] fan-out skipped:', r.error);
            else if ((r?.errors?.length ?? 0) > 0) console.info('[kring-chat] fan-out partial:', r);
          }).catch((err) => {
            console.warn('[kring-chat] fan-out failed:', err?.message ?? err);
          });
        }
      },
      onAction: (action /*, row */) => {
        // V0: per-row actions just log.  Wiring each (Ik help / Ik doe ze /
        // Negeer) to its dispatch lands in SP-13.2.1.
        console.info('[kring] action', action.action, 'on row', action.payload?.rowId);
      },
      more,
    });
  };
  rerender();
  // EventLog has no subscribe seam yet; SP-13.2.1 will poll-on-event so
  // inbound peer messages appear without manual re-render.

  // α.1c — load + materialize the active recipe in the background.
  // Until this resolves, scherm-mode shows the empty-state.  Failure
  // (e.g. corrupt store) falls through to the empty-state too.
  (async () => {
    try {
      const book = await recipeStore.get(id);
      const active = getActiveRecipe(book);
      if (!active) { screenBlocks = []; rerender(); return; }
      const blocks = await materializeRecipe({
        recipe:   active,
        circleId: id,
        hostOps:  { callSkill: resolveCallSkill ?? rawCallSkill, eventLog, circles: circlesCache },
      });
      screenBlocks = blocks;
      if (getActiveCircle() === id) rerender();
    } catch (err) {
      console.warn('[circleApp] recipe load failed:', err?.message ?? err);
      screenBlocks = [];
      if (getActiveCircle() === id) rerender();
    }
  })();
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

  const refresh = async () => {
    try { book = await recipeStore.get(circleId); }
    catch { book = { recipes: [], activeId: null }; }
    if (mode === 'recipe' && !book.recipes.some((r) => r.id === editingRecipeId)) {
      mode = 'book'; editingRecipeId = null;
    }
    rerender();
  };

  const apply = async (mutator) => {
    try { book = await recipeStore.update(circleId, mutator); }
    catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    rerender();
  };

  const rerender = () => {
    renderRecipeEditor(rootEl, {
      book, mode, editingRecipeId, t,
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

// Circle-scoped Folio browser (board 10B) — files come from a circle pod's
// listFiles once wired; empty until then (the scope/normalize is tested).
//
// P6.M8 #350 — share-toggle row (Shared-by-me / Shared-with-me).  Picking
// a toggle re-projects the cached raw `listFiles` result through the
// share-filter substrate; clearing it restores the circle-scoped view.
function showFolio(id) {
  let filter = 'all';
  let shareFilter = null;          // null | 'shared-by-me' | 'shared-with-me'
  let lastListResult = null;       // raw `listFiles` result for re-projection
  let files = buildCircleFiles({ files: [], circleId: id });

  function project() {
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

  const rerender = () => renderCircleFolioBrowser(rootEl, {
    files,
    filter,
    shareFilter,
    t,
    onFilter: (f) => { filter = f; rerender(); },
    onShareFilter: (next) => {
      if (next && !FOLIO_SHARE_FILTERS.includes(next)) return;
      shareFilter = next;
      project();
      rerender();
    },
    onBack: () => showDetail(id),
  });
  rerender();
  if (resolveCallSkill) {
    resolveCallSkill('listFiles', {})
      .then((res) => { lastListResult = res; project(); if (getActiveCircle() === id) rerender(); })
      .catch(() => { /* keep empty */ });
  }
}

// Circle rules document (boards 3B/3C) — editor persists per circle
// (cc.circleRules.<id>); "preview" shows the Agree/Decline consent screen.
// Threading the consent into the real join flow is the follow-on.
const rulesKey = (id) => `cc.circleRules.${id}`;
function showRules(id) {
  let doc = normalizeRulesDoc(null);
  try { const s = localStorage.getItem(rulesKey(id)); if (s) doc = normalizeRulesDoc(JSON.parse(s)); } catch { /* default */ }
  const rerender = () => renderRulesEditor(rootEl, {
    doc,
    t,
    onChange: (patch) => { doc = normalizeRulesDoc({ ...doc, ...patch }); rerender(); },
    onBack: () => showDetail(id),
    // The standalone Agree/Decline preview screen was retired in 5.5d —
    // consent now happens in the create/join wizard.  No `onPreview`.
    onSave: () => {
      try { localStorage.setItem(rulesKey(id), JSON.stringify(doc)); } catch { /* ignore */ }
      showDetail(id);
    },
  });
  rerender();
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
  const rerender = () => renderCircleOverride(rootEl, {
    override: working,
    t,
    onChange: (patch) => { working = mergeMemberOverride(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => { await overrideStore.update(id, working); showDetail(id); },
  });
  rerender();
}

async function showSettings(id) {
  let working = await policyStore.get(id);
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
  const rerender = () => renderCircleSettings(rootEl, {
    policy: working,
    t,
    saveLabel: consensusActive() ? t('circle.settings.send_proposal') : undefined,
    note: pendingNote(),
    onChange: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => {
      if (!consensusActive()) {
        await policyStore.update(id, working);
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

async function boot() {
  rootEl = document.getElementById('circle-root');
  tabBarEl = document.getElementById('circle-tabbar');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  try {
    let eventSeq = 0;
    const agent = await createRealHouseholdAgent({
      publishEvent: (e) => {
        if (!e || typeof e !== 'object') return;
        eventLog.append({
          ...e,
          id: e.id ?? `cc-${Date.now()}-${(eventSeq += 1).toString(36)}`,
          ts: e.ts ?? Date.now(),
        });
      },
      stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
    });
    if (typeof agent?.callSkill === 'function') {
      rawCallSkill = agent.callSkill;
      resolveCallSkill = makeResolvingCallSkill(agent.callSkill);
      sources = circleSourcesFromAgent({ callSkill: resolveCallSkill, circlesStore: agent.circlesStore });
      // SP-13.2.1 — register a peer-router with the kring-chat-message
      // handler + connect the NKN transport (best-effort; no-op when
      // nkn-sdk failed to load).  The ingest hook mirrors the envelope
      // into stoop's itemStore so kring chat history is durable,
      // searchable, and mute/eviction-filtered (parity with /post
      // delivery via `ingestRemotePost`).  EventLog append still drives
      // the live bubble render.
      const ingestKringMessage = async (payload, fromNknAddr) => {
        try {
          return await agent.callSkill('stoop', 'ingestKringMessage', {
            payload, fromNknAddr,
          });
        } catch (err) {
          console.warn('[circleApp] ingestKringMessage failed:', err?.message ?? err);
          return { error: String(err?.message ?? err) };
        }
      };
      // SP-13.2.2 — shared dedup between rehydrator + receiver so a
      // chat that's already in stoop's itemStore doesn't double-append
      // to eventLog if a new envelope arrives mid-session.
      const kringChatDedup = new Set();
      const kringChatHandler = makeKringChatPeerHandler({
        eventLog,
        dedup:   kringChatDedup,
        ingest:  ingestKringMessage,
      });
      // SP-13.2.2 — boot rehydrator: read stoop's stored chats back
      // into the in-memory eventLog so the GESPREK tab shows history
      // after a reload (eventLog is in-memory; itemStore persists).
      rehydrateKringChatsFromStoop({
        callSkill: agent.callSkill,
        eventLog,
        dedup:     kringChatDedup,
      }).catch(() => { /* logged inside */ });
      const peerMessageRouter = makePeerRouter({
        handlers: { 'kring-chat-message': kringChatHandler },
      });
      tryConnectPeerTransport(agent, peerMessageRouter).catch(() => { /* logged inside */ });
      // P6.5 — wire the claim-router hook now that callSkill + override
      // store are both available.  On claim with `tasksToPersonal` on,
      // mirror the claimed task into the primary crew so it shows up in
      // "Mijn dingen".  Uses the existing primary crew (`cc-default`);
      // future slice (P6.5-followup) will surface the resulting mirror
      // tasks in an "ON YOUR LIST" section on the circle detail.
      if (typeof agent.setAfterClaimHook === 'function') {
        agent.setAfterClaimHook(makeAfterClaimHook({
          getOverride:       (id) => overrideStore.get(id),
          resolveCircleName: async (id) => circlesCache.find((c) => c.id === id)?.name ?? null,
          addToPersonalCrew: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
            try {
              return await agent.callSkill('tasks-v0', 'addTask', {
                text,
                crewId:           'cc-default',
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
  showLauncher();
}

boot();
