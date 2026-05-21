/**
 * OnboardScanScreen — camera-first QR scanner that classifies via
 * `classifyQrPayload(text, TASKS_CLASSIFIERS)` and routes per kind.
 *
 * Phase 41.3.2 (2026-05-09).
 *
 *   - kind 'invite'    → call `redeemInvite` skill, joinCrew on success
 *   - kind 'bot-token' → Phase 41.13 — toast for now
 *   - kind 'contact'   → Phase 41.4+ — toast for now
 *   - kind 'recovery'  → navigate to OnboardRestore prefilled
 *   - kind 'unknown'   → inline hint, keep scanner open
 *
 * Mirrors the stoop-mobile pattern (camera-first; "paste instead"
 * fallback for permission-denied).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, TextInput, Alert, ScrollView } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { classifyQrPayload } from '@canopy/react-native/qr';
import { useTheme }          from '@canopy/react-native/theme';

import { TASKS_CLASSIFIERS } from '../lib/qrClassifiers.js';
import { useService }        from '../ServiceContext.js';
import { useSkill }          from '../lib/useSkill.js';
import { useLocalisation }           from '../LocalisationProvider.js';
import { ROUTES }            from '../navigation.js';

export function OnboardScanScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t }  = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanLock, setScanLock] = useState(false);
  const [hint,     setHint]     = useState(null);
  const [pasted,   setPasted]   = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy,     setBusy]     = useState(false);

  const redeem = useSkill('redeemInvite');

  // Reset scan lock + hint each focus.
  useFocusEffect(
    useCallback(() => {
      setScanLock(false);
      setHint(null);
      return () => {};
    }, []),
  );

  const handleClassified = useCallback(async (res) => {
    if (res.kind === 'unknown') {
      setHint(t('mobile.scan.unrecognised'));
      return;
    }

    if (res.kind === 'invite') {
      setBusy(true);
      setHint(t('mobile.scan.redeeming'));
      try {
        const r = await redeem.call({
          invite: res.payload.token,
          // displayName + memberPubKey come from the active identity
          // wired through createCrewAgent / V2.8's CrewState — the
          // skill reads them from the actor context. Tasks-mobile
          // doesn't need to pass them here.
        });
        if (r?.error) {
          setBusy(false);
          setHint(t('mobile.scan.redeem_failed', null).replace('{reason}', r.error));
          return;
        }
        // r.crewConfig is the canonical config the redeem skill returns
        // on success. Tasks-mobile builds the CrewState locally + flips
        // activeCrewId via ServiceContext.
        if (r?.crewConfig) {
          await svc.joinCrew(r.crewConfig, { setActive: true });
        }
        nav.navigate(ROUTES.Workspace ?? ROUTES.Welcome);
      } catch (err) {
        setBusy(false);
        setHint(t('mobile.scan.redeem_failed', null).replace('{reason}', err?.message ?? String(err)));
      }
      return;
    }

    if (res.kind === 'recovery') {
      nav.navigate(ROUTES.OnboardRestore, { prefill: res.payload.words.join(' ') });
      return;
    }

    if (res.kind === 'bot-token') {
      // Phase 41.13 will wire this. For now: surface the payload and
      // let the user know the flow isn't ready.
      Alert.alert('Bot-token (TODO)', `chatId=${res.payload.chatId}, webid=${res.payload.webid}`);
      return;
    }

    if (res.kind === 'contact') {
      Alert.alert('Contact (TODO)', res.payload.uri);
      return;
    }

    // Future kinds.
    setHint(t('mobile.scan.unrecognised'));
  }, [redeem, svc, nav, t]);

  const onBarcode = useCallback(({ data }) => {
    if (scanLock || busy) return;
    const res = classifyQrPayload(String(data), TASKS_CLASSIFIERS);
    if (res.kind === 'unknown') {
      setHint(t('mobile.scan.unrecognised'));
      return;
    }
    setScanLock(true);
    handleClassified(res).catch(() => setScanLock(false));
  }, [scanLock, busy, handleClassified, t]);

  const submitPasted = useCallback(() => {
    const res = classifyQrPayload(pasted, TASKS_CLASSIFIERS);
    if (res.kind === 'unknown') {
      Alert.alert(t('mobile.scan.unrecognised'));
      return;
    }
    handleClassified(res);
  }, [pasted, handleClassified, t]);

  if (permission == null) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.textMuted }}>…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md }}>
          {t('mobile.scan.title')}
        </Text>
        <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted, marginBottom: SPACING.lg, lineHeight: 22 }}>
          {t('mobile.permissions.camera')}
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ backgroundColor: COLORS.primary, padding: SPACING.lg, borderRadius: RADII.md, alignItems: 'center' }}
          accessibilityRole="button"
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
            {t('mobile.scan.grant_camera')}
          </Text>
        </Pressable>

        <PasteToggle
          visible={showPaste}
          value={pasted}
          onChange={setPasted}
          onShow={() => setShowPaste(true)}
          onSubmit={submitPasted}
          theme={{ COLORS, SPACING, FONT_SIZES, RADII }}
          t={t}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <CameraView
        style={{ aspectRatio: 1, backgroundColor: '#000' }}
        facing="back"
        onBarcodeScanned={onBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <ScrollView contentContainerStyle={{ padding: SPACING.xl }}>
        <Text style={{ fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md }}>
          {t('mobile.scan.title')}
        </Text>
        <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted, marginBottom: SPACING.lg, lineHeight: 22 }}>
          {t('mobile.scan.subtitle')}
        </Text>
        {hint ? (
          <Text style={{ color: COLORS.warning, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
            {hint}
          </Text>
        ) : null}

        <PasteToggle
          visible={showPaste}
          value={pasted}
          onChange={setPasted}
          onShow={() => setShowPaste(true)}
          onSubmit={submitPasted}
          theme={{ COLORS, SPACING, FONT_SIZES, RADII }}
          t={t}
        />
      </ScrollView>
    </View>
  );
}

function PasteToggle({ visible, value, onChange, onShow, onSubmit, theme, t }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = theme;
  if (!visible) {
    return (
      <Pressable onPress={onShow} accessibilityRole="link" style={{ paddingVertical: SPACING.lg, alignItems: 'center' }}>
        <Text style={{ color: COLORS.info, fontSize: FONT_SIZES.sm }}>
          {t('mobile.scan.paste_link')}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ marginTop: SPACING.lg }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        placeholder={t('mobile.scan.paste_placeholder')}
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="onboard-paste-input"
        style={{
          minHeight: 96,
          borderWidth: 1,
          borderColor: COLORS.border,
          borderRadius: RADII.sm,
          padding: SPACING.md,
          fontSize: FONT_SIZES.sm,
          color: COLORS.text,
          textAlignVertical: 'top',
          backgroundColor: COLORS.surface,
        }}
      />
      <Pressable
        onPress={onSubmit}
        accessibilityRole="button"
        style={{
          backgroundColor: COLORS.primary,
          padding: SPACING.lg,
          borderRadius: RADII.md,
          alignItems: 'center',
          marginTop: SPACING.md,
        }}
      >
        <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
          {t('mobile.scan.paste_submit')}
        </Text>
      </Pressable>
    </View>
  );
}
