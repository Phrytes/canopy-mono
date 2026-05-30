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
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, quickCreateCircle, setActiveCircle, normalizeCircleMembers,
  circleFilesFromListFiles,
  // 5.9d — Proof-of-Location placeholder seam (real attestation deferred).
  getCirclePolStatus, formatPolStatus,
  // P6.1 — per-kring feature-flag consumption.
  isFeatureEnabled,
  // P6.3 — per-circle activity preview + unread badge.
  buildTilePreviews, bumpSeenAt,
  // P6.5 #342 — claim-router hook (mirror claimed tasks to my own crew).
  makeAfterClaimHook,
  // P6.8 #346 — Nearby/HIER model + label helpers (board 8C).
  buildNearbyModel,
  // P6.M7 #349 — "My things" private notes-list (board 10A).
  myThingsFromListFiles,
} from '@canopy-app/canopy-chat';
import { formatNearbyLabel } from '../../core/nearbyLabel.js';
import { t } from '../../core/localisation.js';
import {
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
  // P6.2 — persisted multi-admin proposals.
  makeProposalStoreRN,
} from '../../core/circleStoresRN.js';
import CircleSettingsScreen from './CircleSettingsScreen.js';
import CircleOverrideScreen from './CircleOverrideScreen.js';
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

// Wrap a top-level surface (Kringen / Stroom / Mij) with the bottom tab bar.
function WithTabBar({ active, onSelect, children }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <CircleTabBar active={active} onSelect={onSelect} />
    </View>
  );
}

export default function CircleLauncherScreen({ bundle, eventLog, onBack, onChatRoute }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // M3 — sub-view within the launcher: 'list' | 'availability' | 'detail'
  // | 'settings' | 'override'.  `selected` carries the active circle for
  // detail/settings/override.
  const [view, setView] = useState('list');
  const [viewAsPolicy, setViewAsPolicy] = useState('pairwise');
  const [viewAsMembers, setViewAsMembers] = useState([]);
  const [folioFiles, setFolioFiles] = useState([]);
  const [skillDraft, setSkillDraft] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [rulesPreview, setRulesPreview] = useState(null);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // P6.1 — selected circle's policy (loaded when `selected` changes); used
  // to gate detail action buttons on the Functies axis (board 4A).
  const [selectedPolicy, setSelectedPolicy] = useState(null);
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
  const availabilityStore = useMemo(() => makeAvailabilityStoreRN(AsyncStorage), []);
  // P6.2 — multi-admin proposal store.  Settings consults this to persist
  // pending consensus proposals + commit on unanimous approval.
  const proposalStore     = useMemo(() => makeProposalStoreRN(AsyncStorage), []);

  const callSkill = useMemo(
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, circlesStore: bundle?.agent?.circlesStore })
        : {};
      setCircles(await loadCircles(sources));
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, [callSkill, bundle]);

  useEffect(() => { load(); }, [load]);

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
  // into the user's primary crew ('cc-default') tagged `via:<circleId>`
  // so the "ON YOUR LIST" section below can surface it.  Web wires the
  // same hook from circleApp.js — keep this parallel.
  useEffect(() => {
    if (typeof bundle?.agent?.setAfterClaimHook !== 'function') return;
    bundle.agent.setAfterClaimHook(makeAfterClaimHook({
      getOverride:       (id) => overrideStore.get(id),
      resolveCircleName: async (id) => circles.find((c) => c.id === id)?.name ?? null,
      addToPersonalCrew: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
        if (typeof bundle.callSkill !== 'function') return null;
        try {
          return await bundle.callSkill('tasks-v0', 'addTask', {
            text,
            crewId:           'cc-default',
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
    // 5.9e — when the circle's `view` axis is 'chat', skip the action-grid
    // detail and route straight to the chat surface (the active-circle
    // dispatch from 5.3 already scopes posts to this circle's thread).
    // Falls through to the default detail when no onChatRoute is wired or
    // the policy axis isn't set.
    if (typeof onChatRoute === 'function') {
      let policyView = null;
      try {
        const p = await policyStore.get(c.id);
        policyView = p?.view ?? null;
      } catch { /* fresh circle / read failure → fall through */ }
      if (policyView === 'chat') { onChatRoute(c.id); return; }
    }
    setSelected(c);
    setView('detail');
    setItems([]);
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill, onChatRoute, policyStore]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); setView('list'); };

  // Bottom tab bar (Kringen / Stroom / Mij).
  const onTab = (id) => {
    if (id === 'kringen') { setActiveCircle(null); setSelected(null); setView('list'); }
    else if (id === 'stroom') setView('stream');
    else if (id === 'mij') setView('availability');
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
  if (selected && view === 'settings') {
    return (
      <CircleSettingsScreen
        store={policyStore}
        proposalStore={proposalStore}
        circleId={selected.id}
        onBack={() => { refreshProposals(); setView('detail'); }}
      />
    );
  }
  if (selected && view === 'override') {
    return <CircleOverrideScreen store={overrideStore} circleId={selected.id} onBack={() => setView('detail')} />;
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
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'rules') {
    return (
      <CircleRulesScreen
        doc={rulesDoc}
        onBack={() => setView('detail')}
        onPreview={(working) => { setRulesPreview(working); setView('rulesconsent'); }}
        onSave={async (doc) => {
          try { await AsyncStorage.setItem(`cc.circleRules.${selected.id}`, JSON.stringify(doc)); } catch { /* ignore */ }
          setRulesDoc(doc);
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
  if (selected) {
    return (
      <CircleDetail
        circle={selected}
        items={items}
        callSkill={callSkill}
        policy={selectedPolicy}
        myListTasks={myListTasks}
        onBack={closeCircle}
        onSettings={() => setView('settings')}
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
          let raw = null;
          try { const s = await AsyncStorage.getItem(`cc.circleRules.${selected.id}`); if (s) raw = JSON.parse(s); } catch { /* fresh */ }
          setRulesDoc(raw);
          setView('rules');
        }}
      />
    );
  }

  return (
    <WithTabBar active="kringen" onSelect={onTab}>
      <View style={styles.page} testID="circle-launcher">
        {onBack ? (
          <View style={styles.bar}>
            <Pressable onPress={onBack} accessibilityRole="button" testID="circle-to-chat">
              <Text style={styles.back}>← chat</Text>
            </Pressable>
          </View>
        ) : null}
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

            {/* P6.8 #346 — Nearby (HIER) entry: full screen below. */}
            <Pressable
              style={styles.shortcut}
              accessibilityRole="button"
              testID="circle-launcher-nearby"
              onPress={() => setView('nearby')}
            >
              <Text style={styles.shortcutText}>{t('circle.nearbyScreen.title')}</Text>
            </Pressable>

            {/* P6.M7 #349 — Mijn dingen entry (private kring). */}
            <Pressable
              style={styles.shortcut}
              accessibilityRole="button"
              testID="circle-launcher-mythings"
              onPress={async () => {
                let fs = [];
                if (callSkill) {
                  try { fs = myThingsFromListFiles(await callSkill('listFiles', {}), null); }
                  catch { /* keep empty */ }
                }
                setMyThingsFiles(fs);
                setView('mythings');
              }}
            >
              <Text style={styles.shortcutText}>{t('circle.folio.my_things_title')}</Text>
            </Pressable>
            {circles.length === 0 ? (
              <Text style={styles.muted}>{t('circle.empty')}</Text>
            ) : (
              circles.map((c) => {
                // P6.3 — preview-aware subtitle + unread badge (board 5A).
                const pv = previews[c.id];
                const subtitle = (pv && pv.subtitle)
                  ? pv.subtitle
                  : (c.memberCount != null ? t('circle.members', { count: c.memberCount }) : null);
                const unread = pv?.unread ?? 0;
                // P6.2 #341 — pending voorstellen badge (yellow) when
                // this circle has admin-approval proposals waiting.
                const pendingProposals = Number(proposalCounts[c.id]) || 0;
                return (
                  <Pressable
                    key={c.id}
                    style={styles.tile}
                    accessibilityRole="button"
                    onPress={() => openCircle(c)}
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
                    {pendingProposals > 0 ? (
                      <View
                        style={styles.tileProposals}
                        accessibilityLabel={t('circle.tile_proposals', { count: pendingProposals })}
                        testID={`circle-tile-proposals-${c.id}`}
                      >
                        <Text style={styles.tileProposalsText}>{pendingProposals}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
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
          </ScrollView>
        )}
      </View>
    </WithTabBar>
  );
}

function CircleDetail({ circle, items, callSkill, policy, myListTasks = [], onBack, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules }) {
  // P6.1 — gate feature-bound action buttons against the policy's
  // Functies axis.  houseRules + memberDirectory landed first; #340
  // closes the loop on the file browser (Folio surfaces the kring's
  // shared lists + notes; board 10).
  const showRules    = isFeatureEnabled(policy, 'houseRules');
  const showViewAs   = isFeatureEnabled(policy, 'memberDirectory');
  const showFiles    = isFeatureEnabled(policy, 'lists') || isFeatureEnabled(policy, 'notes');
  // 5.9d — Proof-of-Location placeholder. Probe `getPolStatus` on mount;
  // when unregistered (today's state) the helper returns {configured:false}
  // and the row renders "Not configured". Real attestation in [[5.9d-followup]].
  const [pol, setPol] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!callSkill || !circle?.id) { setPol(null); return () => { alive = false; }; }
    (async () => {
      const status = await getCirclePolStatus({ callSkill, circleId: circle.id });
      if (alive) setPol(status);
    })();
    return () => { alive = false; };
  }, [callSkill, circle?.id]);

  return (
    <View style={styles.page} testID="circle-detail">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{circle.name || circle.id}</Text>
      {circle.memberCount != null ? (
        <Text style={styles.tileMeta}>{t('circle.members', { count: circle.memberCount })}</Text>
      ) : null}
      <View style={styles.detailActions}>
        <Pressable onPress={onSettings} accessibilityRole="button" testID="circle-detail-settings" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.settings.title')}</Text>
        </Pressable>
        <Pressable onPress={onMine} accessibilityRole="button" testID="circle-detail-mine" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.override.title')}</Text>
        </Pressable>
        {showViewAs ? (
          <Pressable onPress={onViewAs} accessibilityRole="button" testID="circle-detail-viewas" style={styles.detailAction}>
            <Text style={styles.detailActionText}>{t('circle.viewAs.title')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onAdvisor} accessibilityRole="button" testID="circle-detail-advisor" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.advisor.title')}</Text>
        </Pressable>
        <Pressable onPress={onSkills} accessibilityRole="button" testID="circle-detail-skills" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.skills.editor_title')}</Text>
        </Pressable>
        {showFiles ? (
          <Pressable onPress={onFiles} accessibilityRole="button" testID="circle-detail-files" style={styles.detailAction}>
            <Text style={styles.detailActionText}>{t('circle.folio.title')}</Text>
          </Pressable>
        ) : null}
        {showRules ? (
          <Pressable onPress={onRules} accessibilityRole="button" testID="circle-detail-rules" style={styles.detailAction}>
            <Text style={styles.detailActionText}>{t('circle.rules.title')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.polRow} testID="circle-detail-pol">
        <Text style={styles.polLabel}>{t('circle.pol.title')}</Text>
        <Text style={styles.polValue}>{formatPolStatus(pol, t)}</Text>
      </View>
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
      <ScrollView contentContainerStyle={styles.list}>
        {(!items || items.length === 0) ? (
          <Text style={styles.muted}>{t('circle.detail_empty')}</Text>
        ) : (
          items.map((it, i) => (
            <View key={it.id ?? i} style={styles.tile}>
              <Text style={styles.tileName}>
                {it.label || it.title || it.text || it.name || String(it.id ?? '')}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
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
  tile:       { padding: 13, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  createBtnText: { color: theme.color.white, fontSize: 16, fontWeight: '700' },
  // Shared row styles used by NearbyScreen + MyThingsScreen.
  row:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, marginBottom: 6 },
  rowName:    { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  rowMeta:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  ownProfile: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  ownProfileTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  // P6.5 #342 — "ON YOUR LIST" section on CircleDetail.
  onYourList:       { marginTop: 8, paddingHorizontal: 2, paddingVertical: 8 },
  onYourListTitle:  { fontSize: 11, letterSpacing: 1.0, color: theme.color.inkSoft, textTransform: 'uppercase', marginBottom: 6 },
  onYourListRow:    { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  onYourListText:   { fontSize: 13, color: theme.color.ink },
});
