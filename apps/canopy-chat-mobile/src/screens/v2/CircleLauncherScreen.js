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
  loadCircleItems, quickCreateCircle, setActiveCircle,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';
import {
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
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

export default function CircleLauncherScreen({ bundle, eventLog, onBack }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // M3 — sub-view within the launcher: 'list' | 'availability' | 'detail'
  // | 'settings' | 'override'.  `selected` carries the active circle for
  // detail/settings/override.
  const [view, setView] = useState('list');
  const [viewAsPolicy, setViewAsPolicy] = useState('pairwise');
  const [skillDraft, setSkillDraft] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [rulesPreview, setRulesPreview] = useState(null);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // M3 — AsyncStorage-backed circle stores (keys match web's localStorage
  // convention).  Created once; the sub-screens load/save through them.
  const policyStore       = useMemo(() => makeCirclePolicyStoreRN(AsyncStorage), []);
  const overrideStore     = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  const availabilityStore = useMemo(() => makeAvailabilityStoreRN(AsyncStorage), []);

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

  const openCircle = useCallback(async (c) => {
    setActiveCircle(c.id);
    setSelected(c);
    setView('detail');
    setItems([]);
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); setView('list'); };

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
    return <CircleAvailabilityScreen store={availabilityStore} onBack={() => setView('list')} />;
  }
  if (view === 'stream') {
    return (
      <CircleStreamScreen
        eventLog={eventLog}
        circles={circles}
        onBack={() => setView('list')}
        onOpenCircle={(id) => openCircle(circles.find((c) => c.id === id) || { id })}
      />
    );
  }
  if (selected && view === 'settings') {
    return <CircleSettingsScreen store={policyStore} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'override') {
    return <CircleOverrideScreen store={overrideStore} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'viewas') {
    // Members come from the identity-resolver MemberMap once an op surfaces
    // it; empty until then (the reveal projection is fully tested).
    return <CircleViewAsScreen members={[]} policy={viewAsPolicy} onBack={() => setView('detail')} />;
  }
  if (view === 'hop') {
    return <CircleHopScreen callSkill={callSkill} onBack={() => setView('list')} />;
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
    // Files come from a circle pod's listFiles once wired; empty until then.
    return <CircleFolioScreen files={[]} onBack={() => setView('detail')} />;
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
        onBack={closeCircle}
        onSettings={() => setView('settings')}
        onMine={() => setView('override')}
        onViewAs={async () => {
          const p = await policyStore.get(selected.id);
          setViewAsPolicy(p?.revealPolicy ?? 'pairwise');
          setView('viewas');
        }}
        onAdvisor={() => setView('advisor')}
        onSkills={async () => {
          let raw = null;
          try { const s = await AsyncStorage.getItem(`cc.circleSkill.${selected.id}`); if (s) raw = JSON.parse(s); } catch { /* fresh */ }
          setSkillDraft(raw);
          setView('skills');
        }}
        onFiles={() => setView('folio')}
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
    <View style={styles.page} testID="circle-launcher">
      <View style={styles.bar}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" testID="circle-to-chat">
            <Text style={styles.back}>← chat</Text>
          </Pressable>
        ) : null}
        <View style={styles.barActions}>
          <Pressable
            onPress={() => setView('stream')}
            accessibilityRole="button"
            testID="circle-stream-open"
          >
            <Text style={styles.availText}>{t('circle.stream.open')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setView('availability')}
            accessibilityRole="button"
            testID="circle-availability-open"
          >
            <Text style={styles.availText}>{t('circle.availability.title')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setView('hop')}
            accessibilityRole="button"
            testID="circle-hop-open"
          >
            <Text style={styles.availText}>{t('circle.hop.title')}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.title}>{t('circle.title')}</Text>

      {loading ? (
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {circles.length === 0 ? (
            <Text style={styles.muted}>{t('circle.empty')}</Text>
          ) : (
            circles.map((c) => (
              <Pressable
                key={c.id}
                style={styles.tile}
                accessibilityRole="button"
                onPress={() => openCircle(c)}
              >
                <Text style={styles.tileName}>{c.name}</Text>
                {c.memberCount != null ? (
                  <Text style={styles.tileMeta}>{t('circle.members', { count: c.memberCount })}</Text>
                ) : null}
              </Pressable>
            ))
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
  );
}

function CircleDetail({ circle, items, onBack, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules }) {
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
        <Pressable onPress={onViewAs} accessibilityRole="button" testID="circle-detail-viewas" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.viewAs.title')}</Text>
        </Pressable>
        <Pressable onPress={onAdvisor} accessibilityRole="button" testID="circle-detail-advisor" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.advisor.title')}</Text>
        </Pressable>
        <Pressable onPress={onSkills} accessibilityRole="button" testID="circle-detail-skills" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.skills.editor_title')}</Text>
        </Pressable>
        <Pressable onPress={onFiles} accessibilityRole="button" testID="circle-detail-files" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.folio.title')}</Text>
        </Pressable>
        <Pressable onPress={onRules} accessibilityRole="button" testID="circle-detail-rules" style={styles.detailAction}>
          <Text style={styles.detailActionText}>{t('circle.rules.title')}</Text>
        </Pressable>
      </View>
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

const styles = StyleSheet.create({
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  back:       { fontSize: 13, color: theme.color.inkSoft },
  barActions: { flexDirection: 'row', gap: 14, marginLeft: 'auto' },
  availText:  { fontSize: 13, color: theme.color.inkSoft, fontWeight: '600' },
  detailActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 },
  detailAction:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  detailActionText: { fontSize: 12, color: theme.color.inkSoft },
  title:      { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:       { gap: 6, paddingBottom: 32 },
  tile:       { padding: 13, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  tileName:   { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  tileMeta:   { fontSize: 11, color: theme.color.inkSoft, marginTop: 2 },
  muted:      { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  newBtn:     { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, borderRadius: 8, alignItems: 'center' },
  newText:    { color: theme.color.inkSoft },
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  createBtnText: { color: theme.color.white, fontSize: 16, fontWeight: '700' },
});
