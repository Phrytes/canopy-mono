/**
 * OnboardScanScreen — camera-first QR scanner.
 *
 * Stoop V3 Phase 40.10.  Wraps `expo-camera`'s `CameraView` with
 * the `barcodeScannerSettings` and feeds each barcode through
 * `qrScanner.classifyQrPayload`. On a recognised payload, navigates
 * to the right downstream screen:
 *
 *   - kind 'invite'   → Feed (with `pendingInvite` param for the
 *                       redeem flow that lands in 40.10-H).
 *   - kind 'contact'  → Contacts (with `pendingContact` param).
 *   - kind 'recovery' → OnboardRestore (prefilled phrase).
 *   - kind 'unknown'  → inline error, keep the scanner open.
 *
 * A "Plak in plaats daarvan" link below the camera surface accepts
 * a pasted invite / mnemonic when the camera isn't a fit (e.g.
 * permission denied, blurry QR).
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useNavigation, useRoute }       from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                              from '../lib/i18n.js';
import { classifyQrPayload }              from '../lib/qrScanner.js';
import { routeForKind }                   from '../lib/onboardScanRouting.js';

export function OnboardScanScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const [permission, requestPermission] = useCameraPermissions();

  const [pasted,  setPasted]  = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [scanLock, setScanLock] = useState(false);
  const [hint,    setHint]    = useState(null);

  const handleClassified = useCallback((res) => {
    if (res.kind === 'unknown') {
      setHint(t('mobile.scan_unrecognised', 'Onbekende QR-code.'));
      return;
    }
    routeForKind(nav, res, route?.params);
  }, [nav, route]);

  const onBarcode = useCallback(({ data }) => {
    if (scanLock) return;
    const res = classifyQrPayload(String(data));
    if (res.kind === 'unknown') {
      setHint(t('mobile.scan_unrecognised', 'Onbekende QR-code.'));
      return;
    }
    setScanLock(true);
    handleClassified(res);
  }, [scanLock, handleClassified]);

  const submitPasted = useCallback(() => {
    const res = classifyQrPayload(pasted);
    if (res.kind === 'unknown') {
      Alert.alert(t('mobile.scan_unrecognised', 'Onbekende QR-code.'));
      return;
    }
    handleClassified(res);
  }, [pasted, handleClassified]);

  if (permission == null) {
    return <View style={styles.root}><Text style={styles.body}>…</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <View style={styles.permissionPanel}>
          <Text style={styles.title}>
            {t('onboard_scan.heading', 'Scan een QR-code')}
          </Text>
          <Text style={styles.body}>
            {t('mobile.permission_camera_rationale',
               'Stoop wil de camera gebruiken om QR-codes te scannen en foto\'s aan posts toe te voegen.')}
          </Text>
          <Pressable
            onPress={requestPermission}
            style={styles.btnPrimary}
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryLabel}>
              {t('onboard_scan.grant_camera', 'Geef toegang')}
            </Text>
          </Pressable>

          <PasteToggle
            visible={showPaste}
            value={pasted}
            onChange={setPasted}
            onShow={() => setShowPaste(true)}
            onSubmit={submitPasted}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={styles.cameraSurface}
        facing="back"
        onBarcodeScanned={onBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <ScrollView contentContainerStyle={styles.controls}>
        <Text style={styles.title}>
          {t('onboard_scan.heading', 'Scan een QR-code')}
        </Text>
        <Text style={styles.body}>
          {t('onboard_scan.subheading',
             'Richt de camera op een Stoop-QR. Je kan ook plakken in plaats daarvan.')}
        </Text>
        {hint ? <Text style={styles.hintText}>{hint}</Text> : null}

        <PasteToggle
          visible={showPaste}
          value={pasted}
          onChange={setPasted}
          onShow={() => setShowPaste(true)}
          onSubmit={submitPasted}
        />
      </ScrollView>
    </View>
  );
}

export default OnboardScanScreen;

function PasteToggle({ visible, value, onChange, onShow, onSubmit }) {
  if (!visible) {
    return (
      <Pressable onPress={onShow} style={styles.pasteToggle} accessibilityRole="link">
        <Text style={styles.pasteToggleText}>
          {t('onboard_scan.paste_link', 'Plak in plaats daarvan')}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.pasteBlock}>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        placeholder={t('onboard_scan.paste_placeholder',
                       'Plak een Stoop-uitnodiging, contact-link of herstelzin')}
        style={styles.pasteInput}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="onboard-paste-input"
      />
      <Pressable
        onPress={onSubmit}
        style={styles.btnPrimary}
        accessibilityRole="button"
      >
        <Text style={styles.btnPrimaryLabel}>
          {t('onboard_scan.paste_submit', 'Doorgaan')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  cameraSurface: { aspectRatio: 1, backgroundColor: '#000' },
  permissionPanel: { padding: SPACING.xl },
  controls: { padding: SPACING.xl },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  body: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  hintText: {
    color: COLORS.warning,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.md,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  btnPrimaryLabel: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  pasteToggle:    { paddingVertical: SPACING.lg, alignItems: 'center' },
  pasteToggleText: { color: COLORS.info, fontSize: FONT_SIZES.sm },
  pasteBlock:     { marginTop: SPACING.lg },
  pasteInput: {
    minHeight: 96,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.sm, color: COLORS.text,
    textAlignVertical: 'top',
  },
});
