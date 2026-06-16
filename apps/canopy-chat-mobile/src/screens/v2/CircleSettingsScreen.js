/**
 * canopy-chat-mobile v2 — circle settings (RN screen, board 4A · M3).
 *
 * RN counterpart of web's circleSettings renderer over the SAME shared
 * model (`@canopy-app/canopy-chat`): 5 policy axes (feature toggles + 4
 * enum radio groups) + the co-admin consensus toggle + per-option
 * consequence panels (1.2b).  Loads/saves through the injected policy
 * store (AsyncStorage-backed).  When consensus is active (consensusRequired
 * + ≥2 admins) Save records a pending proposal instead of applying.
 *
 * γ.4 — conflict resolution for the circle policy.  When `incomingPolicy`
 * is non-null (the source plumbing — peer broadcast / pod-sync — is
 * deferred to a later slice; today every existing call site passes none
 * of these opts and the screen behaves exactly as before), the screen
 * runs a 3-way diff against the last captured version (γ.2) and — if
 * conflicts surface — overlays the SAME modal (CircleRecipeConflictScreen)
 * used by the recipe editor with a settings-namespaced heading.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS, mergeCirclePolicy, makeProposal, DEFAULT_CIRCLE_ORIGINS,
  detectPolicyConflicts, applyPolicyResolution,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';
import CircleRecipeConflictScreen from './CircleRecipeConflictScreen.js';

// 5.9a — `view` is the per-circle default-pane axis ('chat' / 'screen' /
// 'cross-stream'); making it editable here lets an admin pick which surface
// a member lands on when they open the circle.  Listed first so it stays
// the most prominent setting.
const ENUM_AXES = ['view', 'llmTool', 'agents', 'revealPolicy', 'pod'];

export default function CircleSettingsScreen({
  store, proposalStore, circleId, onBack,
  // γ.4 — opt-in conflict resolver.  See file header for the deferred
  // source plumbing; existing call sites pass none of these opts.
  incomingPolicy = null,
  onIncomingApplied,
  onIncomingDiscarded,
}) {
  const [working, setWorking] = useState(null);
  const [expanded, setExpanded] = useState({});

  // γ.4 — conflict resolver state (parallel to recipe-editor pattern).
  const [conflictReport, setConflictReport] = useState(null);
  const [localForCompare, setLocalForCompare] = useState(null);

  useEffect(() => {
    let live = true;
    store.get(circleId).then((p) => { if (live) setWorking(p); });
    return () => { live = false; };
  }, [store, circleId]);

  // γ.4 — when `incomingPolicy` is present, fetch base + detect + maybe
  // open the modal.  Triggered separately from the initial load so the
  // editor can render its regular form underneath while detection runs.
  useEffect(() => {
    if (incomingPolicy == null || working == null) { return; }
    let live = true;
    (async () => {
      let base = null;
      try {
        if (store && typeof store.listVersions === 'function' && circleId) {
          const versions = await store.listVersions(circleId);
          const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
          base = head && typeof head === 'object' && head.value != null ? head.value : null;
        }
      } catch { /* best-effort */ }

      const report = detectPolicyConflicts(working, incomingPolicy, base);
      if (!live) return;
      setLocalForCompare(working);

      if (report.identical
          || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
        const merged = applyPolicyResolution(working, incomingPolicy, {});
        try {
          if (store && typeof store.update === 'function' && circleId) {
            await store.update(circleId, merged);
          }
        } catch { /* best-effort */ }
        onIncomingApplied?.(merged);
        return;
      }
      setConflictReport(report);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPolicy, working, store, circleId]);

  const handleConflictResolve = async (decisions) => {
    if (!localForCompare || !incomingPolicy) { setConflictReport(null); return; }
    const merged = applyPolicyResolution(localForCompare, incomingPolicy, decisions);
    try {
      if (store && typeof store.update === 'function' && circleId) {
        await store.update(circleId, merged);
      }
    } catch { /* best-effort */ }
    setConflictReport(null);
    onIncomingApplied?.(merged);
  };

  const patch = useCallback((p) => setWorking((cur) => mergeCirclePolicy(cur, p)), []);

  const consensusActive = !!working?.consensusRequired && (working?.admins?.length ?? 0) >= 2;

  const onSave = useCallback(async () => {
    if (!working) return;
    if (consensusActive) {
      // P6.2 — record + persist the pending proposal.  When unanimous
      // (single-admin / proposer in `requiredApprovers`), commit
      // immediately + drop the proposal; otherwise keep it pending.
      const proposal = makeProposal({
        circleId, patch: working, proposedBy: null, policy: working,
      });
      if (proposalStore) {
        await proposalStore.save(proposal);
        if (proposal.status === 'ready') {
          await store.update(circleId, working);
          await proposalStore.remove(proposal.id);
        }
      }
    } else {
      await store.update(circleId, working);
    }
    onBack?.();
  }, [working, consensusActive, store, proposalStore, circleId, onBack]);

  // γ.4 — overlay rendered on top of the regular screen when a conflict
  // is detected.  Mirrors CircleRecipeEditorScreen's pattern (β.5).
  const conflictOverlay = conflictReport ? (
    <CircleRecipeConflictScreen
      visible
      conflicts={conflictReport}
      local={localForCompare}
      incoming={incomingPolicy}
      title="circle.settings.conflict.title"
      onResolve={handleConflictResolve}
      onCancel={() => { setConflictReport(null); onIncomingDiscarded?.(); }}
    />
  ) : null;

  if (!working) {
    return (
      <>
        <View style={styles.page} testID="circle-settings">
          <Text style={styles.muted}>{t('circle.loading')}</Text>
        </View>
        {conflictOverlay}
      </>
    );
  }

  return (
    <>
    <View style={styles.page} testID="circle-settings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-settings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.settings.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('circle.settings.features')}</Text>
        {CIRCLE_FEATURES.map((f) => (
          <View key={f} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.settings.feat.${f}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working.features?.[f]}
              onValueChange={(v) => patch({ features: { [f]: v } })}
              testID={`feat-${f}`}
            />
          </View>
        ))}

        {/* S6.C deep — which whole apps this circle composes (catalog scope). */}
        <Text style={styles.section}>{t('circle.settings.apps')}</Text>
        {DEFAULT_CIRCLE_ORIGINS.map((app) => {
          const current = Array.isArray(working.apps) ? working.apps : DEFAULT_CIRCLE_ORIGINS;
          return (
            <View key={app} style={styles.row}>
              <Text style={styles.rowLabel}>{t(`circle.settings.app.${app}`)}</Text>
              <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                value={current.includes(app)}
                onValueChange={(on) => {
                  const set = new Set(current);
                  if (on) set.add(app); else set.delete(app);
                  patch({ apps: DEFAULT_CIRCLE_ORIGINS.filter((a) => set.has(a)) });
                }}
                testID={`app-${app}`}
              />
            </View>
          );
        })}

        {ENUM_AXES.map((axis) => (
          <View key={axis}>
            <Text style={styles.section}>{t(`circle.settings.${axis}`)}</Text>
            {CIRCLE_POLICY_ENUMS[axis].map((opt) => {
              const consKey = `circle.settings.consequence.${opt}`;
              const consText = t(consKey);
              const hasCons = consText && consText !== consKey;
              const selected = working[axis] === opt;
              return (
                <View key={opt} style={[styles.optBox, selected && styles.optBoxSelected]}>
                  <View style={styles.optRow}>
                    <Pressable
                      style={styles.optTap}
                      onPress={() => patch({ [axis]: opt })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`opt-${opt}`}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.rowLabel}>{t(`circle.settings.opt.${opt}`)}</Text>
                    </Pressable>
                    {hasCons ? (
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [opt]: !e[opt] }))}
                        accessibilityRole="button"
                        accessibilityLabel={t('circle.settings.consequence_aria')}
                        testID={`info-${opt}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.info}>ⓘ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {hasCons && expanded[opt] ? (
                    <Text style={styles.consequence} testID={`consequence-${opt}`}>{consText}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.section}>{t('circle.settings.consensus')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.settings.consensus_label')}</Text>
          <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
            value={!!working.consensusRequired}
            onValueChange={(v) => patch({ consensusRequired: v })}
            testID="consensusRequired"
          />
        </View>
        {consensusActive ? <Text style={styles.note}>{t('circle.settings.pending')}</Text> : null}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-settings-save">
        <Text style={styles.saveText}>
          {consensusActive ? t('circle.settings.send_proposal') : t('circle.settings.save')}
        </Text>
      </Pressable>
    </View>
    {conflictOverlay}
    </>
  );
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 24 },
  section:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel:    { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  // radio-as-box (board 4) — selected option boxed with a terracotta ring.
  optBox:        { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.paper, paddingHorizontal: 12, marginBottom: 8 },
  optBoxSelected:{ borderColor: theme.color.accent, backgroundColor: theme.color.card },
  optRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  optTap:      { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color.line, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  radioOn:     { borderColor: theme.color.accent },
  radioDot:    { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.color.accent },
  info:        { fontSize: 16, color: theme.color.accent, paddingHorizontal: 6 },
  consequence: { fontSize: 12, color: theme.color.inkSoft, backgroundColor: theme.color.paper2, borderLeftWidth: 3, borderLeftColor: theme.color.accent, borderRadius: 6, padding: 8, marginBottom: 10 },
  note:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 8 },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  save:        { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText:    { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});
