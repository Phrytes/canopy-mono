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
 *   3. Pod sign-in card — M1-S5. Status display + entry point.
 *      The actual PKCE OAuth runs on the dedicated PodSignInScreen
 *      (the proven stoop-mobile RN pattern — a separate screen owns
 *      the `useTasksAuth` hook so the expo-auth-session TS chain
 *      stays off this screen's module-parse graph, mirroring why
 *      PodSignInScreen exists). This card NAVIGATES there to sign
 *      in; status + sign-out use the registered skills
 *      (`podSignInStatus` / `signOutOfPod`) whose ids/return shapes
 *      match tasks-v0 Slice 5 (same surface stoop-mobile's
 *      ProfileMineScreen consumes). Sign-in completion still flows
 *      through the shared apps/tasks-v0 podSignIn.js orchestration
 *      via the injected-session seam (PodSignInScreen →
 *      svc.attachPod, which keeps the skill's status holder synced).
 *
 * M1-S5 (2026-05-18); S5 parse-fix (2026-05-18) — dropped the inline
 * `useTasksAuth` import (it transitively pulls expo-auth-session's
 * TypeScript, which rollup/vitest can't parse at module load);
 * navigation to PodSignInScreen preserves identical behaviour.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill }   from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';
import { ROUTES }     from '../navigation.js';

const STORAGE_POLICIES    = ['no-pod', 'centralised', 'decentralised', 'hybrid'];
const UPGRADEABLE_POLICIES = ['centralised', 'decentralised', 'hybrid'];

export function PodSettingsScreen() {
  const nav        = useNavigation();
  const svc        = useService();
  const { t }      = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const setCrewStoragePolicy = useSkill('setCrewStoragePolicy');

  const activeCircleId = svc?.activeCircleId;
  const activeCs     = activeCircleId ? svc?.crews?.get?.(activeCircleId) : null;
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
    if (!activeCircleId || !setCrewStoragePolicy?.call) return;
    setUpgradeBusy(true);
    setUpgradeError(null);
    try {
      const result = await setCrewStoragePolicy.call({
        circleId:      activeCircleId,
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
  }, [activeCircleId, setCrewStoragePolicy, upgradePolicy, upgradePodUri, needsPodUri]);

  // Section 2: agent-registry status
  const registryStatus = activeCs?.agentRegistry
    ? 'registered'
    : (activeCs ? 'not-registered' : 'no-crew');

  // ── Section 3: pod OIDC sign-in (M1-S5) ───────────────────────────
  // The PKCE OAuth runs on the dedicated PodSignInScreen (it owns
  // the `useTasksAuth` hook). This card shows status + routes there
  // to sign in, and uses the registered skills for status/sign-out.
  const signOutOfPod      = useSkill('signOutOfPod');
  const podSignInStatusSk = useSkill('podSignInStatus');

  const [signInBusy, setSignInBusy]   = useState(false);
  const [signInError, setSignInError] = useState(null);
  const [signInState, setSignInState] = useState({ signedIn: false, webid: null });

  const refreshSignInStatus = useCallback(async () => {
    if (!podSignInStatusSk?.call) return;
    try {
      const r = await podSignInStatusSk.call({});
      setSignInState({
        signedIn: !!r?.signedIn,
        webid:    r?.webid ?? null,
      });
    } catch { /* read-only; ignore transient errors */ }
  }, [podSignInStatusSk]);

  useEffect(() => {
    // Reflect any existing pod attachment + the live ServiceContext
    // podStatus (PodSignInScreen → svc.attachPod keeps the shared
    // holder in sync, so the podSignInStatus skill agrees). Re-checks
    // whenever podStatus changes (e.g. after returning from sign-in).
    if (svc?.podStatus?.signedIn) {
      setSignInState({ signedIn: true, webid: svc.podStatus.webid ?? null });
    } else {
      refreshSignInStatus();
    }
  }, [svc?.podStatus?.signedIn, svc?.podStatus?.webid, refreshSignInStatus]);

  const onPodSignIn = useCallback(() => {
    // Navigate to the dedicated sign-in screen. It runs the PKCE
    // flow via useTasksAuth + svc.attachPod (which syncs the shared
    // podCrew holder so this screen's status skill reflects it on
    // return). Same flow + shared podSignIn.js orchestration as
    // before — just isolated to the screen that owns the hook.
    nav.navigate(ROUTES.PodSignIn);
  }, [nav]);

  const onPodSignOut = useCallback(async () => {
    if (signInBusy) return;
    setSignInBusy(true);
    setSignInError(null);
    try {
      await signOutOfPod.call({});
      // Keep ServiceContext's pod plumbing in sync (detach inner +
      // clear the OidcSessionRN it holds).
      try { await svc?.detachPod?.(); } catch { /* best-effort */ }
      setSignInState({ signedIn: false, webid: null });
    } catch (err) {
      setSignInError(err?.message ?? String(err));
    } finally {
      setSignInBusy(false);
    }
  }, [signInBusy, signOutOfPod, svc]);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, backgroundColor: COLORS.background, padding: SPACING.xl,
      }}
    >
      {/* ── Section 1: Storage policy ─────────────────────────────── */}
      <SectionHeader title={t('mobile.pod_settings.section_storage', 'Storage policy')} />

      {!activeCircleId ? (
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

      {/* ── Section 3: Pod sign-in (M1-S5) ───────────────────────── */}
      <SectionHeader title={t('mobile.pod_settings.section_signin', 'Solid pod sign-in')} />
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
        {t('mobile.pod_settings.signin_body',
          'Signing in to a Solid pod lets your tasks sync across devices via your ' +
          'personal data store. Optional — Tasks works fully offline.')}
      </Text>

      {signInState.signedIn ? (
        <>
          <Row
            label={t('mobile.pod_settings.signin_webid', 'Signed in as')}
            value={signInState.webid ?? t('mobile.pod_settings.signin_webid_unknown', '(unknown WebID)')}
          />
          <Pressable
            onPress={onPodSignOut}
            disabled={signInBusy}
            accessibilityRole="button"
            accessibilityLabel="pod-settings-signout"
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
              borderRadius: RADII.sm, borderWidth: 1, borderColor: COLORS.border,
              backgroundColor: COLORS.surface, alignSelf: 'flex-start',
              marginTop: SPACING.md,
            }}
          >
            {signInBusy ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                {t('mobile.pod_settings.signout_cta', 'Sign out of pod')}
              </Text>
            )}
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={onPodSignIn}
          accessibilityRole="button"
          accessibilityLabel="pod-settings-signin"
          style={({ pressed }) => [
            {
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
              borderRadius: RADII.sm,
              backgroundColor: COLORS.primary,
              alignSelf: 'flex-start',
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={{
            color: COLORS.textInverse,
            fontSize: FONT_SIZES.sm, fontWeight: '600',
          }}>
            {t('mobile.pod_settings.signin_cta', 'Sign in to Solid pod')}
          </Text>
        </Pressable>
      )}

      {signInError ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md }}>
          {signInError}
        </Text>
      ) : null}
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
