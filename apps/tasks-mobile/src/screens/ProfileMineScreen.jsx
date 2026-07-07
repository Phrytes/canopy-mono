/**
 * ProfileMineScreen — the user's own profile.
 *
 * Phase 41.10 (2026-05-09).
 *
 * Edits handle / displayName / avatar / skills / holidayMode via the
 * V1+ profile skills. Avatar via the substrate's `pickAndResize`
 * (Phase 41.0 L3) with the AVATAR_PRESET. The recovery-phrase reveal
 * uses the substrate's `useMnemonicReveal` hook (Phase 41.0 L5) +
 * `<MnemonicView>` component.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme }      from '@canopy/react-native/theme';
import { AvatarCircle }  from '@canopy/react-native/components';
import { pickAndResize } from '@canopy/react-native/picker';
import { useMnemonicReveal } from '@canopy/react-native/mnemonic';
import { MnemonicView }      from '@canopy/react-native/mnemonic/view';
import { validateHandle, normaliseHandle } from '@canopy/identity-resolver/display';

import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { AVATAR_PRESET }  from '../lib/photoPresets.js';
import { ROUTES }         from '../navigation.js';

export function ProfileMineScreen() {
  const svc = useService();
  const nav = useNavigation();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const get   = useSkillResult('getMyProfile', {}, [svc?.activeCircleId]);
  const setHandleSkill   = useSkill('setMyHandle');
  const setNameSkill     = useSkill('setMyDisplayName');
  const setAvatarSkill   = useSkill('setMyAvatarUrl');
  const setHoliday       = useSkill('setHolidayMode');

  const profile = get?.data?.profile ?? get?.data ?? null;

  const [handle,      setHandle]      = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [holidayMode, setHolidayMode] = useState(!!profile?.holidayMode);
  const [handleErr,   setHandleErr]   = useState(null);

  useEffect(() => {
    if (!profile) return;
    setHandle(profile.handle ?? '');
    setDisplayName(profile.displayName ?? '');
    setHolidayMode(!!profile.holidayMode);
  }, [profile?.handle, profile?.displayName, profile?.holidayMode]);

  const onPickAvatar = useCallback(async (mode) => {
    try {
      const out = await pickAndResize({ mode, preset: AVATAR_PRESET, max: 1 });
      const photo = out[0];
      if (!photo) return;
      // Store as a data-URL alongside the user's profile namespace
      // (mirrors the deliverable photo pattern).
      const cs = svc?.circles?.get(svc?.activeCircleId);
      const ref = `mem://user/avatars/${svc?.identity?.pubKey ?? 'me'}.jpg`;
      try { await cs?.dataSource?.write?.(ref, `data:image/jpeg;base64,${photo.dataB64}`); }
      catch { /* swallow — avatar URL still updates */ }
      await setAvatarSkill.call({ url: ref });
      get.refresh().catch(() => {});
    } catch { /* swallow */ }
  }, [svc, setAvatarSkill, get]);

  const onSaveHandle = useCallback(async () => {
    const tidy = normaliseHandle(handle);
    const v = validateHandle(tidy);
    if (!v.ok) { setHandleErr(v.reason); return; }
    setHandleErr(null);
    await setHandleSkill.call({ handle: tidy }).catch(() => {});
    get.refresh().catch(() => {});
  }, [handle, setHandleSkill, get]);

  const onSaveName = useCallback(async () => {
    await setNameSkill.call({ displayName }).catch(() => {});
    get.refresh().catch(() => {});
  }, [displayName, setNameSkill, get]);

  const onToggleHoliday = useCallback(async (next) => {
    setHolidayMode(!!next);
    await setHoliday.call({ on: !!next }).catch(() => {});
  }, [setHoliday]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <View style={{ alignItems: 'center', marginBottom: SPACING.lg }}>
        <AvatarCircle
          uri={profile?.avatarUri ?? profile?.avatarUrl ?? null}
          name={profile?.displayName ?? handle}
          size={96}
        />
        <View style={{ flexDirection: 'row', marginTop: SPACING.sm, gap: SPACING.sm }}>
          <Pressable
            onPress={() => onPickAvatar('camera')}
            accessibilityRole="button"
            accessibilityLabel="profile-avatar-camera"
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
              borderRadius: RADII.pill, backgroundColor: COLORS.primary,
            }}
          >
            <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm }}>
              {t('mobile.profile.avatar_camera')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onPickAvatar('library')}
            accessibilityRole="button"
            accessibilityLabel="profile-avatar-library"
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
              borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
            }}
          >
            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
              {t('mobile.profile.avatar_library')}
            </Text>
          </Pressable>
        </View>
      </View>

      <Field label={t('mobile.profile.handle')}>
        <TextInput
          value={handle}
          onChangeText={(s) => { setHandle(s); setHandleErr(null); }}
          onBlur={onSaveHandle}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="profile-handle-input"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        />
        {handleErr ? (
          <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: 4 }}>
            {t(`mobile.profile.handle_${handleErr}`, handleErr)}
          </Text>
        ) : null}
      </Field>

      <Field label={t('mobile.profile.display_name')}>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          onBlur={onSaveName}
          accessibilityLabel="profile-display-name-input"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        />
      </Field>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginVertical: SPACING.md,
      }}>
        <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.text }}>
          {t('mobile.profile.holiday_mode')}
        </Text>
        <Switch value={holidayMode} onValueChange={onToggleHoliday} accessibilityLabel="profile-holiday-toggle" />
      </View>

      {/* 41.18.3 — Edit my skills CTA */}
      <Pressable
        onPress={() => nav.navigate(ROUTES.EditSkills)}
        accessibilityRole="button"
        accessibilityLabel="profile-edit-skills"
        style={({ pressed }) => [
          {
            marginTop: SPACING.md, marginBottom: SPACING.sm,
            paddingVertical: SPACING.md,
            paddingHorizontal: SPACING.md,
            borderRadius: RADII.sm,
            borderWidth: 1, borderColor: COLORS.border,
            backgroundColor: COLORS.surface,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' }}>
          {t('mobile.profile.edit_skills_cta')}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
          {t('mobile.profile.edit_skills_hint')}
        </Text>
      </Pressable>

      <RecoverySection />
    </ScrollView>
  );
}

function RecoverySection() {
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const reveal = useMnemonicReveal({ useSkill: useSkillForReveal });

  return (
    <View style={{
      marginTop: SPACING.xl, padding: SPACING.md,
      borderRadius: RADII.md, backgroundColor: COLORS.surfaceMuted,
    }}>
      <Text style={{ fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm }}>
        {t('mobile.profile.recovery_title')}
      </Text>
      <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md }}>
        {t('mobile.profile.recovery_body')}
      </Text>

      {reveal.words ? (
        <MnemonicView
          words={reveal.words}
          warningLabel={t('mobile.profile.recovery_warning')}
          copyLabel={t('mobile.profile.recovery_copy')}
        />
      ) : (
        <Pressable
          onPress={() => reveal.reveal()}
          accessibilityRole="button"
          accessibilityLabel="profile-reveal-recovery"
          disabled={reveal.loading}
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            borderRadius: RADII.pill, backgroundColor: COLORS.danger,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
            {reveal.loading ? '…' : t('mobile.profile.recovery_reveal_cta')}
          </Text>
        </Pressable>
      )}

      {reveal.error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm }}>
          {String(reveal.error?.message ?? reveal.error)}
        </Text>
      ) : null}
    </View>
  );
}

// useSkillForReveal — closes over our useSkill so the substrate's
// useMnemonicReveal hook gets the right per-app binding.
function useSkillForReveal(skillId) {
  return useSkill(skillId);
}

function Field({ label, children }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{
        fontSize: FONT_SIZES.sm, color: COLORS.text, fontWeight: '500',
        marginBottom: SPACING.sm,
      }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function _inputStyle(COLORS, SPACING, FONT_SIZES, RADII) {
  return {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    backgroundColor: COLORS.surface,
  };
}

