/**
 * WelcomeScreen — empty-state landing for first launch + after a
 * sign-out / leave-all-crews. Shows three onboarding paths:
 *
 *   1. Scan an invite QR  (→ ROUTES.OnboardScan)
 *   2. Restore from recovery phrase  (→ ROUTES.OnboardRestore)
 *   3. Create a solo crew (testing affordance)  — local-only;
 *      the user becomes admin of a single-member crew. Matches the
 *      V0 desktop default (`bin/tasks-ui.js --role admin`). Useful
 *      while a real invite-QR-issuing flow isn't reachable.
 *
 * Phase 41.3.1 (2026-05-09); 41.16 follow-up adds the solo-crew
 * affordance.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useI18n } from '../I18nProvider.js';
import { ROUTES } from '../navigation.js';

export function WelcomeScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [showSolo, setShowSolo] = useState(false);
  const [crewName, setCrewName] = useState('My household');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);

  const onCreateSolo = useCallback(async () => {
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
        kind: 'household',
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
      setShowSolo(false);
      nav.navigate(ROUTES.Workspace);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [svc, busy, crewName, nav]);

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
        onPress={() => nav.navigate(ROUTES.OnboardScan)}
        accessibilityRole="button"
        accessibilityLabel="welcome-scan-cta"
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
          {t('mobile.welcome.scan_cta')}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardRestore)}
        accessibilityRole="button"
        accessibilityLabel="welcome-restore-cta"
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
          {t('mobile.welcome.restore_cta')}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setShowSolo(true)}
        accessibilityRole="button"
        accessibilityLabel="welcome-solo-cta"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.md,
            alignItems: 'center',
            marginTop: SPACING.lg,
          },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.welcome.solo_cta', 'Create a solo crew (testing)')}
        </Text>
      </Pressable>

      <Modal
        transparent
        visible={showSolo}
        animationType="fade"
        onRequestClose={() => setShowSolo(false)}
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
              {t('mobile.welcome.solo_modal_title', 'Create a solo crew')}
            </Text>
            <Text style={{
              fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
              marginBottom: SPACING.md, lineHeight: 20,
            }}>
              {t('mobile.welcome.solo_modal_body',
                 'You\'ll be the admin of a single-member crew. Local-only — no relay, no pod. Useful for testing the V0/V1 flow.')}
            </Text>
            <TextInput
              value={crewName}
              onChangeText={setCrewName}
              placeholder="My household"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel="solo-crew-name-input"
              style={{
                borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
                backgroundColor: COLORS.surface,
              }}
            />
            {error ? (
              <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg }}>
              <Pressable
                onPress={() => setShowSolo(false)}
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
                onPress={onCreateSolo}
                disabled={busy || !crewName.trim()}
                accessibilityRole="button"
                accessibilityLabel="solo-crew-create"
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
                    {t('mobile.welcome.solo_create', 'Create')}
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
