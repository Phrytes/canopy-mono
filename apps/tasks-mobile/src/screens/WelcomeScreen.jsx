/**
 * WelcomeScreen — empty-state landing for first launch + after a
 * sign-out / leave-all-crews. Shows three onboarding paths:
 *
 *   1. Create a new crew  (→ creates the crew + jumps to OnboardIssue
 *      so the admin can issue invites for the rest of the household /
 *      project / team. The first-run path most users want.)
 *   2. Scan an invite QR  (→ ROUTES.OnboardScan)
 *   3. Restore from recovery phrase  (→ ROUTES.OnboardRestore)
 *
 * Phase 41.3.1 (2026-05-09).
 * 41.16 follow-up — added a solo-crew affordance.
 * 41.18 follow-up — promoted "solo crew (testing)" to a first-class
 *                   "Create a new crew" flow with kind picker + a
 *                   handoff into OnboardIssue (the existing invite-
 *                   QR screen). This makes the mobile bring-up path
 *                   match the desktop's `--crew` + invite flow.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useLocalisation } from '../LocalisationProvider.js';
import { ROUTES } from '../navigation.js';

export function WelcomeScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [showCreate, setShowCreate] = useState(false);
  const [crewName,   setCrewName]   = useState('My household');
  const [crewKind,   setCrewKind]   = useState('household');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState(null);

  // 41.18 follow-up — CrewsDashboard's "+ New crew" FAB navigates
  // here with `{openCreate: true}`. Open the modal automatically.
  useEffect(() => {
    if (route?.params?.openCreate) setShowCreate(true);
  }, [route?.params?.openCreate]);

  const onCreateCrew = useCallback(async () => {
    if (!svc?.joinCrew || busy) return;
    setBusy(true);
    setError(null);
    try {
      const pubKey = svc?.identity?.pubKey ?? 'local';
      const actor  = svc?.identity?.webid ?? `webid://local-${pubKey.slice(0, 12)}`;
      const crewId = `crew-${Date.now().toString(36)}`;
      await svc.joinCrew({
        crewId,
        name: crewName.trim() || 'My household',
        kind: crewKind,
        members: [
          {
            webid:       actor,
            displayName: 'Me',
            pubKey,
            role:        'admin',
          },
        ],
        customRoles: [],
      }, { setActive: true });
      setShowCreate(false);
      // Land on the invite-issue screen so the admin can immediately
      // share a QR with the rest of the household / project / team.
      // We `reset` so a back-tap from OnboardIssue lands on the Main
      // tab shell (the user's home base), not the now-stale Welcome.
      nav.reset({
        index: 1,
        routes: [
          { name: ROUTES.Main },
          { name: ROUTES.OnboardIssue, params: { freshlyCreated: true } },
        ],
      });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [svc, busy, crewName, crewKind, nav]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        padding: SPACING.xl,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: FONT_SIZES.xxl,
          fontWeight: '600',
          color: COLORS.text,
          marginBottom: SPACING.md,
        }}
      >
        {t('mobile.welcome.title')}
      </Text>
      <Text
        style={{
          fontSize: FONT_SIZES.md,
          color: COLORS.textMuted,
          marginBottom: SPACING.xxl,
          lineHeight: 22,
        }}
      >
        {t('mobile.welcome.subtitle')}
      </Text>

      <Pressable
        onPress={() => setShowCreate(true)}
        accessibilityRole="button"
        accessibilityLabel="welcome-create-cta"
        style={({ pressed }) => [
          {
            backgroundColor: COLORS.primary,
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            marginBottom: SPACING.md,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text
          style={{
            color: COLORS.textInverse,
            fontSize: FONT_SIZES.md,
            fontWeight: '600',
          }}
        >
          {t('mobile.welcome.create_cta', 'Create a new crew')}
        </Text>
      </Pressable>

      {/* M1-S2 — full wizard with storage-policy picker */}
      <Pressable
        onPress={() => nav.navigate(ROUTES.CreateCrew)}
        accessibilityRole="button"
        accessibilityLabel="welcome-create-crew-wizard-cta"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.sm,
            alignItems: 'center',
            marginBottom: SPACING.xs,
          },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
          {t('mobile.welcome.create_crew_wizard_cta', 'Create with storage policy…')}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardScan)}
        accessibilityRole="button"
        accessibilityLabel="welcome-scan-cta"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.surface,
            marginBottom: SPACING.md,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text
          style={{
            color: COLORS.text,
            fontSize: FONT_SIZES.md,
            fontWeight: '500',
          }}
        >
          {t('mobile.welcome.scan_cta')}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardRestore)}
        accessibilityRole="button"
        accessibilityLabel="welcome-restore-cta"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.md,
            alignItems: 'center',
            marginTop: SPACING.sm,
          },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.welcome.restore_cta')}
        </Text>
      </Pressable>

      <Modal
        transparent
        visible={showCreate}
        animationType="fade"
        onRequestClose={() => setShowCreate(false)}
      >
        <View style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          backgroundColor: COLORS.overlay, padding: SPACING.lg,
        }}>
          <View style={{
            width: '100%', maxWidth: 400,
            backgroundColor: COLORS.surface,
            borderRadius: RADII.md, padding: SPACING.xl,
          }}>
            <Text style={{
              fontSize: FONT_SIZES.lg, fontWeight: '600',
              color: COLORS.text, marginBottom: SPACING.sm,
            }}>
              {t('mobile.welcome.create_modal_title', 'Create a new crew')}
            </Text>
            <Text style={{
              fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
              marginBottom: SPACING.md, lineHeight: 20,
            }}>
              {t('mobile.welcome.create_modal_body',
                 'You become the admin. Invite the rest with a QR after creation.')}
            </Text>

            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, marginBottom: SPACING.xs }}>
              {t('mobile.welcome.create_name_label', 'Crew name')}
            </Text>
            <TextInput
              value={crewName}
              onChangeText={setCrewName}
              placeholder="My household"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel="create-crew-name-input"
              style={{
                borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
                backgroundColor: COLORS.surface,
                marginBottom: SPACING.md,
              }}
            />

            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, marginBottom: SPACING.xs }}>
              {t('mobile.welcome.create_kind_label', 'Crew type')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[
                { id: 'household',   label: t('mobile.crews.kind_household')   },
                { id: 'project',     label: t('mobile.crews.kind_project')     },
                { id: 'team',        label: t('mobile.crews.kind_team')        },
                { id: 'friends',     label: t('mobile.crews.kind_friends')     },
                { id: 'maintenance', label: t('mobile.crews.kind_maintenance') },
              ].map((c) => {
                const active = crewKind === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCrewKind(c.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`create-crew-kind-${c.id}`}
                    style={{
                      paddingVertical: SPACING.xs,
                      paddingHorizontal: SPACING.sm,
                      borderRadius: RADII.pill,
                      borderWidth: 1,
                      borderColor: active ? COLORS.primaryDark : COLORS.border,
                      backgroundColor: active ? COLORS.primary : COLORS.surface,
                      marginRight: SPACING.xs,
                      marginBottom: SPACING.xs,
                    }}
                  >
                    <Text style={{
                      color: active ? COLORS.textInverse : COLORS.text,
                      fontSize: FONT_SIZES.xs,
                      fontWeight: active ? '600' : '500',
                    }}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg }}>
              <Pressable
                onPress={() => setShowCreate(false)}
                accessibilityRole="button"
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.sm, marginLeft: SPACING.sm,
                  backgroundColor: COLORS.surfaceMuted,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
                  {t('mobile.common.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={onCreateCrew}
                disabled={busy || !crewName.trim()}
                accessibilityRole="button"
                accessibilityLabel="create-crew-submit"
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.sm, marginLeft: SPACING.sm,
                  backgroundColor: (busy || !crewName.trim()) ? COLORS.surfaceMuted : COLORS.primary,
                }}
              >
                {busy ? (
                  <ActivityIndicator color={COLORS.textInverse} />
                ) : (
                  <Text style={{
                    color: (!crewName.trim()) ? COLORS.textMuted : COLORS.textInverse,
                    fontSize: FONT_SIZES.md, fontWeight: '600',
                  }}>
                    {t('mobile.welcome.create_submit', 'Create + invite')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
