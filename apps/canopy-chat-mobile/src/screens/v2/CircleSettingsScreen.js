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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS, mergeCirclePolicy, makeProposal, DEFAULT_CIRCLE_ORIGINS,
  detectPolicyConflicts, applyPolicyResolution,
} from '@canopy-app/canopy-chat';
// B · Slice 2 — the shared manifest-driven settings form + per-skill freedom matrix (web≡mobile).
import { buildSettingsForm, buildCapabilityMatrix, FREEDOM_LEVELS, OPT_OUT_CONSEQUENCES } from '@canopy/app-manifest';
import { buildManifestsByOrigin } from '../../core/composeManifests.js';
import { t } from '../../core/localisation.js';
import CircleRecipeConflictScreen from './CircleRecipeConflictScreen.js';
import GuidedSetupPanel from './GuidedSetupPanel.js';
import PairedDevices from './PairedDevices.js';
// §4 storage-policy bridge — the circle `pod` axis drives stoop's authoritative
// four-tier crew storage policy (shared with web; pure mapping + call).
import { pushCircleStoragePolicy } from '../../../../canopy-chat/src/v2/circleStoragePolicy.js';

// Theme B — the guided-setup chatbot template can be HQ-updated remotely; unset
// → the bundled DEFAULT_SETTINGS_TEMPLATE fallback (web's SETTINGS_TEMPLATE_URL).
const SETTINGS_TEMPLATE_URL = process.env.EXPO_PUBLIC_SETTINGS_TEMPLATE_URL || undefined;

// 5.9a — `view` is the per-circle default-pane axis ('chat' / 'screen' /
// 'cross-stream'); making it editable here lets an admin pick which surface
// a member lands on when they open the circle.  Listed first so it stays
// the most prominent setting.
const ENUM_AXES = ['view', 'llmTool', 'agents', 'revealPolicy', 'pod'];

export default function CircleSettingsScreen({
  store, proposalStore, circleId, onBack,
  // §4 storage-policy bridge — the host injects the agent's raw callSkill so a
  // pod-tier change drives stoop.setCrewStoragePolicy (web parity).
  callSkill,
  // γ.4 — opt-in conflict resolver.  See file header for the deferred
  // source plumbing; existing call sites pass none of these opts.
  incomingPolicy = null,
  onIncomingApplied,
  onIncomingDiscarded,
  // OBJ-2 — paired devices (no-pod sync). Host wires these from the agent bundle when
  // household sync is available; add/remove persist + return the updated roster.
  householdSelfAddr = null,
  householdPeers = [],
  onAddHouseholdPeer,
  onRemoveHouseholdPeer,
}) {
  const [working, setWorking] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [guidedOpen, setGuidedOpen] = useState(false);   // Theme B — guided-setup chatbot modal
  const [storageNote, setStorageNote] = useState(null);  // §4 — stoop storage-policy rejection note
  const baselinePodRef = useRef(undefined);              // §4 — pod tier at load (push only on change)

  // γ.4 — conflict resolver state (parallel to recipe-editor pattern).
  const [conflictReport, setConflictReport] = useState(null);
  const [localForCompare, setLocalForCompare] = useState(null);

  useEffect(() => {
    let live = true;
    store.get(circleId).then((p) => {
      if (!live) return;
      setWorking(p);
      baselinePodRef.current = p?.pod;   // baseline for this editing session
    });
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

  const patch = useCallback((p) => {
    setStorageNote(null);   // §4 — any edit dismisses a stale storage-policy note
    setWorking((cur) => mergeCirclePolicy(cur, p));
  }, []);

  // B · Slice 2 — the manifest sources drive the settings form + freedom matrix (web≡mobile via the
  // shared @canopy/app-manifest projectors + the shared circlePolicy store).
  const sources = useMemo(() => [...new Set(Object.values(buildManifestsByOrigin()))].map((m) => ({ manifest: m })), []);
  const settingsForms = useMemo(() => (working ? sources
    .map((s) => ({ app: s.manifest?.app, fields: buildSettingsForm(s.manifest, { scope: 'circle', values: settingValuesForApp(working, s.manifest?.app) }) }))
    .filter((f) => f.app && f.fields.length) : []), [sources, working]);
  const capMatrix = useMemo(() => (working ? buildCapabilityMatrix(sources, {
    enabledApps: Array.isArray(working.apps) && working.apps.length ? working.apps : null,
    template: working.capabilities || {},
  }) : []), [sources, working]);

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
      // §4 storage-policy bridge — when the pod tier changed, drive stoop's
      // authoritative crew storage policy (web parity). The skill owns
      // admin-gating + the one-way guard; a rejection surfaces as a note and
      // never blocks the local save.
      if (working?.pod !== baselinePodRef.current && typeof callSkill === 'function') {
        const res = await pushCircleStoragePolicy({
          callSkill, circleId, pod: working.pod, groupPodUri: working.groupPodUri,
        });
        if (!res.ok) {
          const key = `circle.settings.storage_err.${res.error}`;
          const msg = t(key);
          setStorageNote((msg && msg !== key) ? msg : t('circle.settings.storage_err.generic'));
          return;   // stay on settings so the admin sees why the tier didn't take
        }
      }
    }
    onBack?.();
  }, [working, consensusActive, store, proposalStore, circleId, onBack, callSkill]);

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
        {/* Theme B — walk the basics in chat, then pre-fill the form below (the GUI hand-off). */}
        <Pressable
          style={styles.guided}
          onPress={() => setGuidedOpen(true)}
          accessibilityRole="button"
          testID="circle-settings-guided"
        >
          <Text style={styles.guidedText}>{t('circle.guided.button')}</Text>
        </Pressable>

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
        {storageNote ? <Text style={styles.note} testID="circle-settings-storage-note">{storageNote}</Text> : null}

        {/* B · Slice 2 (Q1) — manifest-driven per-app settings form */}
        {settingsForms.length ? (
          <>
            <Text style={styles.section}>{t('circle.settings.appSettings')}</Text>
            {settingsForms.map(({ app, fields }) => (
              <View key={app}>
                <Text style={styles.subhead}>{t(`circle.settings.app.${app}`)}</Text>
                {fields.map((f) => {
                  const key = `${app}.${f.key}`;
                  return (
                    <View key={key} style={styles.row}>
                      <Text style={styles.rowLabel}>{f.label}{f.required ? ' *' : ''}</Text>
                      {f.control === 'toggle' ? (
                        <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                          value={!!f.value} onValueChange={(v) => patch({ settings: { [key]: v } })} testID={`setting-${key}`} />
                      ) : f.control === 'choice' ? (
                        <View style={styles.chipRow}>
                          {(f.choices || []).map((c) => (
                            <Pressable key={c} onPress={() => patch({ settings: { [key]: c } })}
                              style={[styles.chip, f.value === c && styles.chipOn]} testID={`setting-${key}-${c}`}>
                              <Text style={styles.chipText}>{c}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <TextInput style={styles.input} value={f.value == null ? '' : String(f.value)}
                          keyboardType={f.control === 'number' ? 'numeric' : 'default'}
                          onChangeText={(txt) => patch({ settings: { [key]: f.control === 'number' ? (txt === '' ? undefined : Number(txt)) : txt } })}
                          testID={`setting-${key}`} />
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {/* B · Slice 2 (Q3) — the per-skill freedom matrix (what the gate enforces) */}
        {capMatrix.length ? (
          <>
            <Text style={styles.section}>{t('circle.settings.capabilities')}</Text>
            {groupByApp(capMatrix).map(([app, rows]) => (
              <View key={app}>
                <Text style={styles.subhead}>{t(`circle.settings.app.${app}`)}</Text>
                {rows.map((row) => {
                  const base = { enabled: row.enabled, freedom: row.freedom, consequence: row.consequence, privacyFloor: row.privacyFloor };
                  return (
                    <View key={row.key} style={styles.capRow} testID={`cap-${row.key}`}>
                      <View style={styles.row}>
                        <Text style={styles.rowLabel}>{`${verbLabel(row.atom)} · ${row.noun}`}</Text>
                        <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                          value={row.enabled} onValueChange={(v) => patch({ capabilities: { [row.key]: { ...base, enabled: v } } })}
                          testID={`cap-${row.key}-enabled`} />
                      </View>
                      {row.enabled ? (
                        <View style={styles.chipRow}>
                          {FREEDOM_LEVELS.map((lvl) => (
                            <Pressable key={lvl} disabled={row.privacyFloor} onPress={() => patch({ capabilities: { [row.key]: { ...base, freedom: lvl } } })}
                              style={[styles.chip, row.freedom === lvl && styles.chipOn, row.privacyFloor && styles.chipDisabled]}
                              testID={`cap-${row.key}-freedom-${lvl}`}>
                              <Text style={styles.chipText}>{t(`circle.settings.freedom.${lvl}`)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {row.enabled && row.freedom === 'optional' ? (
                        <View style={styles.chipRow}>
                          {OPT_OUT_CONSEQUENCES.map((c) => (
                            <Pressable key={c} onPress={() => patch({ capabilities: { [row.key]: { ...base, consequence: c } } })}
                              style={[styles.chip, row.consequence === c && styles.chipOn]} testID={`cap-${row.key}-cons-${c}`}>
                              <Text style={styles.chipText}>{t(`circle.settings.consequence_opt.${c}`)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {row.privacyFloor ? <Text style={styles.note}>{t('circle.settings.privacyFloor')}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {householdSelfAddr && typeof onAddHouseholdPeer === 'function' ? (
          <>
            <Text style={styles.section}>{t('circle.pairedDevices.title')}</Text>
            <PairedDevices
              selfAddr={householdSelfAddr}
              peers={householdPeers}
              t={t}
              onAdd={onAddHouseholdPeer}
              onRemove={onRemoveHouseholdPeer}
            />
          </>
        ) : null}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-settings-save">
        <Text style={styles.saveText}>
          {consensusActive ? t('circle.settings.send_proposal') : t('circle.settings.save')}
        </Text>
      </Pressable>
    </View>
    {conflictOverlay}
    <GuidedSetupPanel
      visible={guidedOpen}
      templateUrl={SETTINGS_TEMPLATE_URL}
      t={t}
      onDone={(p) => patch(p)}
      onClose={() => setGuidedOpen(false)}
    />
    </>
  );
}

/** B · Slice 2 — the `policy.settings` values for one app: "<app>.<key>" → `{ key: value }`. */
function settingValuesForApp(policy, app) {
  const out = {};
  const all = (policy && typeof policy.settings === 'object' && policy.settings) || {};
  const prefix = `${app}.`;
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/** Group freedom-matrix rows by app (preserving order). */
function groupByApp(matrix) {
  const byApp = new Map();
  for (const row of matrix) { if (!byApp.has(row.app)) byApp.set(row.app, []); byApp.get(row.app).push(row); }
  return [...byApp.entries()];
}

/** Localised atom verb label, falling back to the atom when no key is translated (t() echoes the key on a miss). */
function verbLabel(atom) {
  const k = `circle.settings.verb.${atom}`;
  const v = t(k);
  return v && v !== k ? v : atom;
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
  guided:      { marginTop: 4, marginBottom: 4, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.card, alignItems: 'center' },
  guidedText:  { color: theme.color.accent, fontSize: 14, fontWeight: '600' },
  // B · Slice 2 — settings form + freedom matrix
  subhead:     { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginTop: 10, marginBottom: 2 },
  input:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, minWidth: 90, color: theme.color.ink, textAlign: 'right' },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  chip:        { borderWidth: 1, borderColor: theme.color.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.color.paper },
  chipOn:      { borderColor: theme.color.accent, backgroundColor: theme.color.card },
  chipDisabled:{ opacity: 0.4 },
  chipText:    { fontSize: 12, color: theme.color.ink },
  capRow:      { borderBottomWidth: 1, borderBottomColor: theme.color.line, paddingBottom: 6, marginBottom: 2 },
});
