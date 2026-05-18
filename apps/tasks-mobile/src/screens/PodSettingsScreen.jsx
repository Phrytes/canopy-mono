/**
 * PodSettingsScreen — Pod & storage settings surface.
 *
 * M1-S4 (2026-05-18). Mirrors tasks-v0's `/pod-settings.html` +
 * stoop-mobile's "My Solid pods" section in ProfileMineScreen.
 *
 * Sections:
 *   1. Storage policy — current policy display + upgrade row
 *      (one-way, no downgrade). Calls `setCrewStoragePolicy`.
 *   2. Agent-registry status — reads `activeCs.agentRegistry`.
 *   3. Pod sign-in card — display-only stub. S5 will wire the
 *      4 OIDC skills. The button is disabled + a "coming soon" note
 *      is shown so the surface exists without a broken flow.
 *
 * NOTE: S5 (pod OIDC sign-in) is deliberately NOT implemented here.
 * See PLAN-mobile-v2-substrate-parity.md §M1 table row "S5 — deferred".
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill }   from '../lib/useSkill.js';
import { useI18n }    from '../I18nProvider.js';

const STORAGE_POLICIES    = ['no-pod', 'centralised', 'decentralised', 'hybrid'];
const UPGRADEABLE_POLICIES = ['centralised', 'decentralised', 'hybrid'];

export function PodSettingsScreen() {
  const nav        = useNavigation();
  const svc        = useService();
  const { t }      = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const setCrewStoragePolicy = useSkill('setCrewStoragePolicy');

  const activeCrewId = svc?.activeCrewId;
  const activeCs     = activeCrewId ? svc?.crews?.get?.(activeCrewId) : null;
  const currentStorage = activeCs?.liveCrew?.storage ?? { policy: 'no-pod', groupPodUri: null };

  const [showUpgrade, setShowUpgrade]   = useState(false);
  const [upgradePolicy, setUpgradePolicy] = useState(
    UPGRADEABLE_POLICIES[0],
  );
  const [upgradePodUri, setUpgradePodUri] = useState('');
  const [upgradeBusy, setUpgradeBusy]   = useState(false);
  const [upgradeError, setUpgradeError] = useState(null);
  const [upgradeOk, setUpgradeOk]       = useState(false);

  const needsPodUri = upgradePolicy === 'centralised' || upgradePolicy === 'hybrid';

  const onUpgrade = useCallback(async () => {
    if (!activeCrewId || !setCrewStoragePolicy?.call) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      const result = await setCrewStoragePolicy.call({
        crewId:      activeCrewId,
        storagePolicy: upgradePolicy,
        ...(needsPodUri && upgradePodUri.trim() ? { groupPodUri: upgradePodUri.trim() } : {}),
      });
      if (result?.error) {
        setUpgradeError(result.error);
      } else {
        setUpgradeOk(true);
        setShowUpgrade(false);
      }
    } catch (err) {
      setUpgradeError(err?.message ?? String(err));
    } finally {
      setUpgradeBusy(false);
    }
  }, [activeCrewId, setCrewStoragePolicy, upgradePolicy, upgradePodUri, needsPodUri]);

  // Section 2: agent-registry status
  const registryStatus = activeCs?.agentRegistry
    ? 'registered'
    : (activeCs ? 'not-registered' : 'no-crew');

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, backgroundColor: COLORS.background, padding: SPACING.xl,
      }}
    >
      {/* ── Section 1: Storage policy ─────────────────────────────── */}
      <SectionHeader title={t('mobile.pod_settings.section_storage', 'Storage policy')} />

      {!activeCrewId ? (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg }}>
          {t('mobile.pod_settings.no_crew', 'No active crew.')}
        </Text>
      ) : (
        <>
          <Row
            label={t('mobile.pod_settings.current_policy', 'Current policy')}
            value={t(`mobile.pod_settings.policy_${currentStorage.policy}`, currentStorage.policy)}
          />
          {currentStorage.groupPodUri ? (
            <Row
              label={t('mobile.pod_settings.group_pod_uri', 'Group pod URI')}
              value={currentStorage.groupPodUri}
            />
          ) : null}
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.md, lineHeight: 18 }}>
            {t(`mobile.pod_settings.policy_hint_${currentStorage.policy}`, '')}
          </Text>

          {upgradeOk ? (
            <Text style={{ color: COLORS.success ?? COLORS.primary, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
              {t('mobile.pod_settings.upgrade_ok', 'Storage policy updated.')}
            </Text>
          ) : null}

          {!showUpgrade ? (
            <Pressable
              onPress={() => setShowUpgrade(true)}
              accessibilityRole="button"
              accessibilityLabel="pod-settings-upgrade-cta"
              style={({ pressed }) => [
                {
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.sm, borderWidth: 1, borderColor: COLORS.border,
                  backgroundColor: COLORS.surface, alignSelf: 'flex-start',
                  marginBottom: SPACING.lg,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                {t('mobile.pod_settings.upgrade_cta', 'Upgrade storage policy…')}
              </Text>
            </Pressable>
          ) : (
            <View style={{
              borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.md,
              padding: SPACING.lg, marginBottom: SPACING.lg,
              backgroundColor: COLORS.surface,
            }}>
              <Text style={{ fontWeight: '600', color: COLORS.text, fontSize: FONT_SIZES.md, marginBottom: SPACING.md }}>
                {t('mobile.pod_settings.upgrade_title', 'Upgrade storage policy')}
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.md }}>
                {t('mobile.pod_settings.upgrade_hint', 'This is one-way — you cannot downgrade once a pod is attached.')}
              </Text>
              {STORAGE_POLICIES.filter((p) => p !== 'no-pod').map((p) => {
                const active = upgradePolicy === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setUpgradePolicy(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`pod-settings-upgrade-policy-${p}`}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: SPACING.sm, marginBottom: SPACING.xs,
                    }}
                  >
                    <View style={{
                      width: 16, height: 16, borderRadius: 8, borderWidth: 2,
                      borderColor: active ? COLORS.primary : COLORS.border,
                      backgroundColor: active ? COLORS.primary : 'transparent',
                      marginRight: SPACING.sm,
                    }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: active ? '600' : '400' }}>
                        {t(`mobile.create_crew.policy_${p}`, p)}
                      </Text>
                      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
                        {t(`mobile.create_crew.policy_hint_${p}`, '')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {needsPodUri ? (
                <TextInput
                  value={upgradePodUri}
                  onChangeText={setUpgradePodUri}
                  placeholder="https://pod.example/groups/my-crew/"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel="pod-settings-upgrade-pod-uri"
                  style={{
                    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                    padding: SPACING.md, fontSize: FONT_SIZES.sm, color: COLORS.text,
                    backgroundColor: COLORS.background, marginTop: SPACING.sm,
                    marginBottom: SPACING.md,
                  }}
                />
              ) : null}
              {upgradeError ? (
                <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm }}>
                  {upgradeError}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={() => setShowUpgrade(false)}
                  accessibilityRole="button"
                  style={{
                    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                    borderRadius: RADII.sm, marginRight: SPACING.sm,
                    backgroundColor: COLORS.surfaceMuted,
                  }}
                >
                  <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                    {t('mobile.common.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onUpgrade}
                  disabled={upgradeBusy}
                  accessibilityRole="button"
                  accessibilityLabel="pod-settings-upgrade-submit"
                  style={{
                    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                    borderRadius: RADII.sm,
                    backgroundColor: upgradeBusy ? COLORS.surfaceMuted : COLORS.primary,
                  }}
                >
                  {upgradeBusy ? (
                    <ActivityIndicator color={COLORS.textInverse} />
                  ) : (
                    <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
                      {t('mobile.pod_settings.upgrade_submit', 'Upgrade')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}

      {/* ── Section 2: Agent-registry status ─────────────────────── */}
      <SectionHeader title={t('mobile.pod_settings.section_registry', 'Agent registry')} />
      <Row
        label={t('mobile.pod_settings.registry_status', 'Status')}
        value={t(`mobile.pod_settings.registry_${registryStatus}`,
          registryStatus === 'registered' ? 'Registered' :
          registryStatus === 'not-registered' ? 'Not registered' :
          'No active crew')}
      />
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.lg, lineHeight: 18 }}>
        {t('mobile.pod_settings.registry_hint',
          'The agent-registry records which capabilities this device exposes ' +
          '(tasks, tasks-v0, crew:<id>). Registered when a meshAgent + substrate ' +
          'are both available.')}
      </Text>

      {/* ── Section 3: Pod sign-in (S5 stub) ─────────────────────── */}
      <SectionHeader title={t('mobile.pod_settings.section_signin', 'Solid pod sign-in')} />
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
        {t('mobile.pod_settings.signin_body',
          'Signing in to a Solid pod lets your tasks sync across devices via your ' +
          'personal data store. Optional — Tasks works fully offline.')}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.md }}>
        {t('mobile.pod_settings.signin_coming_soon',
          'Pod sign-in (S5) is coming in the next slice.')}
      </Text>
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="pod-settings-signin-stub"
        style={{
          paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
          borderRadius: RADII.sm, borderWidth: 1, borderColor: COLORS.border,
          backgroundColor: COLORS.surfaceMuted, alignSelf: 'flex-start',
          opacity: 0.5,
        }}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.pod_settings.signin_cta', 'Sign in to Solid pod')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function SectionHeader({ title }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <Text style={{
      fontSize: FONT_SIZES.xs, fontWeight: '600', color: COLORS.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginBottom: SPACING.sm, marginTop: SPACING.lg,
    }}>
      {title}
    </Text>
  );
}

function Row({ label, value }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start',
      paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
      marginBottom: SPACING.xs,
    }}>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, width: 120 }}>
        {label}
      </Text>
      <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}
