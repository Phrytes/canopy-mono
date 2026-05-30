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
import { buildCircleStream } from '../../src/v2/circleStream.js';
import { computeAdvice, makeTooBusyEvent } from '../../src/v2/circleAdvisor.js';
import { normalizeHopMode } from '../../src/v2/circleHop.js';
import { mergeSkill, normalizeSkill } from '../../src/v2/circleSkills.js';
import { buildCircleFiles, circleFilesFromListFiles } from '../../src/v2/circleFolio.js';
import { renderCircleStream } from './circleStream.js';
import { renderCircleAdvisor } from './circleAdvisor.js';
import { renderCircleHop } from './circleHop.js';
import { renderSkillEditor } from './circleSkillEditor.js';
import { renderCircleFolioBrowser } from './circleFolio.js';
import { normalizeRulesDoc } from '../../src/v2/circleRules.js';
import { renderRulesEditor } from './circleRulesEditor.js';
import { renderRulesConsent } from './circleRulesConsent.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircleItems } from '../../src/v2/circleContent.js';
import { getCirclePolStatus } from '../../src/v2/circlePol.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { normalizeCircleMembers } from '../../src/v2/circleMembers.js';
import { mergeCirclePolicy, mergeMemberOverride } from '../../src/v2/circlePolicy.js';
import { makeProposal, pendingApprovers } from '../../src/v2/circleConsensus.js';
import { createProposalStore, localStorageProposalIo } from '../../src/v2/circleProposalStore.js';
import { buildTilePreviews, bumpSeenAt } from '../../src/v2/circleTilePreviews.js';
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
import { renderCircleDetail } from './circleDetail.js';
import { renderCircleSettings } from './circleSettings.js';
import { renderCircleOverride } from './circleOverride.js';

const policyStore = createCirclePolicyStore(localStoragePolicyIo());
const overrideStore = createMemberOverrideStore(localStorageOverrideIo());
const availabilityStore = createAvailabilityStore(localStorageAvailabilityIo());
// P6.2 — persisted pending proposals (multi-admin consensus).
const proposalStore = createProposalStore({ io: localStorageProposalIo() });
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
    t,
    onOpenCircle: showDetail,
    onNewCircle: createCircle,
  });
  showTabBar('kringen');
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
  if (!rawCallSkill) { location.href = './classic.html'; return; } // fallback: create in classic shell
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
  // 5.9e — when `view` is 'chat' the launcher routes straight to the
  // classic chat shell instead of opening the action-grid detail.  The
  // active-circle dispatch from 5.3 already scopes posts to this circle.
  // P6.1 — same policy peek feeds the Functies-axis gate on CircleDetail.
  let detailPolicy = null;
  try {
    detailPolicy = await policyStore.get(id);
    if (detailPolicy?.view === 'chat') {
      window.location.href = `/classic.html?circle=${encodeURIComponent(id)}`;
      return;
    }
  } catch { /* fresh circle / read failure → fall through to detail */ }
  const onSettings = () => showSettings(id);
  const onMine = () => showOverride(id);
  const onViewAs = () => showViewAs(id);
  const onAdvisor = () => showAdvisor(id);
  const onSkills = () => showSkills(id);
  const onFiles = () => showFolio(id);
  const onRules = () => showRules(id);
  const detailOpts = { onBack: showLauncher, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules };
  renderCircleDetail(rootEl, { circle, items: [], pol: null, policy: detailPolicy, t, ...detailOpts });

  if (!resolveCallSkill) return;
  // 5.9d — probe PoL in parallel with items load; both feed renderCircleDetail.
  let items = [];
  let pol   = null;
  try {
    [items, pol] = await Promise.all([
      loadCircleItems({ callSkill: resolveCallSkill, circleId: id }),
      getCirclePolStatus({ callSkill: resolveCallSkill, circleId: id }),
    ]);
  } catch { /* keep empty */ }
  if (getActiveCircle() === id) {
    renderCircleDetail(rootEl, { circle, items, pol, policy: detailPolicy, t, ...detailOpts });
  }
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

// Circle-scoped Folio browser (board 10B) — files come from a circle pod's
// listFiles once wired; empty until then (the scope/normalize is tested).
function showFolio(id) {
  let filter = 'all';
  let files = buildCircleFiles({ files: [], circleId: id });
  const rerender = () => renderCircleFolioBrowser(rootEl, {
    files,
    filter,
    t,
    onFilter: (f) => { filter = f; rerender(); },
    onBack: () => showDetail(id),
  });
  rerender();
  // F-5.2 — real files from the folio listFiles op, scoped to this circle.
  if (resolveCallSkill) {
    resolveCallSkill('listFiles', {})
      .then((res) => { files = circleFilesFromListFiles(res, id); if (getActiveCircle() === id) rerender(); })
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
    onPreview: () => showRulesConsent(id, doc),
    onSave: () => {
      try { localStorage.setItem(rulesKey(id), JSON.stringify(doc)); } catch { /* ignore */ }
      showDetail(id);
    },
  });
  rerender();
}

function showRulesConsent(id, doc) {
  // Preview from the editor — Agree/Decline just return to the editor.
  renderRulesConsent(rootEl, {
    doc,
    t,
    onBack: () => showRules(id),
    onAgree: () => showRules(id),
    onDecline: () => showRules(id),
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
