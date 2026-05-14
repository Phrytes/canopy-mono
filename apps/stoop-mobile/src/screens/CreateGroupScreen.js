/**
 * CreateGroupScreen — minimal "make a new group" wizard.
 *
 * Stoop V3 Phase 40.18 (2026-05-08).  V1 of the screen ships
 * **two questions** (group id + display name) — the full 6-question
 * wizard from `/create-group.html` lands as a follow-up enhancement
 * once the basic flow is real-device-verified.
 *
 * On submit → `createGroupV2({groupId, name, rules: {}})` →
 * ServiceContext.addGroup → navigate to OnboardIssueScreen with
 * the freshly-issued admin invite token, so the user can show a QR
 * to the next member straight away.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';

const GROUP_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/;

export function CreateGroupScreen() {
  const nav = useNavigation();
  const svc = useService();

  const [groupId, setGroupId]   = useState('');
  const [name, setName]         = useState('');
  const [purpose, setPurpose]   = useState('');
  const [storagePolicy, setStoragePolicy] = useState('no-pod');
  const [groupPodUri, setGroupPodUri]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);

  const create = useSkill('createGroupV2');

  const validId = GROUP_ID_RE.test(groupId);
  const ok      = validId && name.trim().length > 0;

  const submit = useCallback(async () => {
    if (!ok || busy) return;
    setBusy(true); setError(null);
    const needsPod = storagePolicy === 'centralised' || storagePolicy === 'hybrid';
    if (needsPod && groupPodUri.trim().length === 0) {
      setError(t('create_group.storage_pod_uri_required',
                 'Vul een pod-URI in voor deze opslagvorm.'));
      setBusy(false);
      return;
    }
    try {
      const r = await create.call({
        groupId,
        name: name.trim(),
        rules: { purpose: purpose.trim() || null },
        storagePolicy,
        ...(needsPod ? { groupPodUri: groupPodUri.trim() } : {}),
      });
      if (r?.error) throw new Error(r.error);

      // Promote the user's local agent: register the new group
      // bundle in the ServiceContext so the rest of the app sees it.
      await svc.addGroup({
        groupId,
        displayName: name.trim(),
        role: 'admin',
      });

      // Stoop's invite is a `{groupId, name, code, expiresAt}`
      // membership code (NOT the signed-token `issueInvite` design).
      // `name` is the user-friendly display name — without it, the
      // receiver falls back to the groupId slug and the two phones
      // show different things in their group manager.
      if (r?.code) {
        nav.replace(ROUTES.OnboardIssue, {
          invite: {
            groupId,
            name:      name.trim(),
            code:      r.code,
            expiresAt: r.expiresAt,
          },
        });
        return;
      }
      nav.navigate(ROUTES.Shell, { screen: ROUTES.Feed });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [ok, busy, create, svc, nav, groupId, name, purpose, storagePolicy, groupPodUri]);

  // C4 — storage policies (§II.2). Localised on render.
  const POLICY_OPTIONS = [
    {
      value:    'no-pod',
      title:    t('create_group.storage_no_pod_label',        'Op onze apparaten (no-pod, default).'),
      subtitle: t('create_group.storage_no_pod_hint',         'Geen pod nodig. Items repliceren naar alle leden\'s pseudo-pod.'),
    },
    {
      value:    'centralised',
      title:    t('create_group.storage_centralised_label',   'Op een gedeelde Solid-pod.'),
      subtitle: t('create_group.storage_centralised_hint',    'Eén pod als bron van waarheid. Beste voor kleinere groepen.'),
    },
    {
      value:    'decentralised',
      title:    t('create_group.storage_decentralised_label', 'Iedereen op z\'n eigen pod (cross-pod refs).'),
      subtitle: t('create_group.storage_decentralised_hint',  'Geen centraal punt. Beste voor grote buurten.'),
    },
    {
      value:    'hybrid',
      title:    t('create_group.storage_hybrid_label',        'Gemengd — ledger op gedeelde pod, drafts lokaal.'),
      subtitle: t('create_group.storage_hybrid_hint',         'Voor groepen met af-en-toe-actieve leden.'),
    },
  ];
  const needsPod = storagePolicy === 'centralised' || storagePolicy === 'hybrid';

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {t('create_group.heading', 'Nieuwe groep maken')}
      </Text>
      <Text style={styles.body}>
        {t('create_group.intro_mobile',
           'Een groep is een afspraak tussen leden. Je wordt automatisch admin van de groep die je aanmaakt; daarna kun je een uitnodiging sturen.')}
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>
          {t('create_group.id_label', 'Groep-id (kleine letters, cijfers, - of _)')}
        </Text>
        <TextInput
          value={groupId}
          onChangeText={(s) => setGroupId(s.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('create_group.id_placeholder', 'bv. oosterpoort-skills')}
          style={styles.input}
          accessibilityLabel="create-group-id"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t('create_group.name_label', 'Groep-naam')}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('create_group.name_placeholder', 'bv. Oosterpoort skills')}
          style={styles.input}
          accessibilityLabel="create-group-name"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          {t('create_group.purpose_label', 'Waar is de groep voor? (optioneel)')}
        </Text>
        <TextInput
          value={purpose}
          onChangeText={setPurpose}
          placeholder={t('create_group.purpose_placeholder',
                         'bv. Buurtgenoten in Groningen-Oosterpoort die elkaar willen helpen.')}
          style={[styles.input, styles.inputMultiline]}
          multiline
          accessibilityLabel="create-group-purpose"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          {t('create_group.q7_storage', '7. Waar staat de groepsstaat?')}
        </Text>
        <Text style={styles.hint}>
          {t('create_group.q7_storage_intro_mobile',
             'Standaard op jullie eigen apparaten. Je kunt later upgraden naar een gedeelde pod. Eenmaal pod-having → niet meer terug.')}
        </Text>
        {POLICY_OPTIONS.map((o) => {
          const selected = storagePolicy === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => setStoragePolicy(o.value)}
              style={[styles.policyRow, selected && styles.policyRowSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`storage-policy-${o.value}`}
            >
              <View style={[styles.radioDot, selected && styles.radioDotSelected]} />
              <View style={styles.policyText}>
                <Text style={styles.policyTitle}>{o.title}</Text>
                <Text style={styles.policySubtitle}>{o.subtitle}</Text>
              </View>
            </Pressable>
          );
        })}
        {needsPod ? (
          <View style={styles.podUriRow}>
            <Text style={styles.label}>
              {t('create_group.storage_group_pod_label', 'Pod-URI van de gedeelde groepspod')}
            </Text>
            <TextInput
              value={groupPodUri}
              onChangeText={setGroupPodUri}
              placeholder="https://buurt.pod/"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              accessibilityLabel="create-group-pod-uri"
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <View>
          <Text style={styles.errorText}>{error}</Text>
          {/* Diagnostic strip — phase 40.23 follow-up. Stays visible
              while we're stabilising the no-groups → first-group
              transition; helps surface root cause when an error
              appears. */}
          <Text style={styles.debugText}>
            status={String(svc?.status)} · identity={svc?.identity ? 'ok' : 'null'}
            {' '}· activeBundle={svc?.activeBundle ? 'ok' : 'null'}
            {svc?.error ? ` · svcError=${svc.error.message}` : ''}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={!ok || busy}
        style={[styles.btnPrimary, (!ok || busy) && styles.btnDisabled]}
        accessibilityRole="button"
        accessibilityLabel="create-group-submit"
      >
        <Text style={styles.btnPrimaryLabel}>
          {busy ? t('create_group.creating', 'Maken…')
                : t('create_group.submit',   'Maak groep')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default CreateGroupScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.textMuted, marginVertical: SPACING.md, lineHeight: 22 },
  section: { marginBottom: SPACING.lg },
  label:   { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  debugText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm, fontFamily: 'monospace' },
  hint:    { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md, lineHeight: 18 },
  policyRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    backgroundColor: COLORS.surface,
  },
  policyRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceMuted },
  radioDot: {
    width: 16, height: 16, marginTop: 2, marginRight: SPACING.md,
    borderRadius: 8, borderWidth: 2, borderColor: COLORS.border,
  },
  radioDotSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  policyText: { flex: 1 },
  policyTitle:    { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  policySubtitle: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginTop: 2, lineHeight: 18 },
  podUriRow: { marginTop: SPACING.sm },
});
