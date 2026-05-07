/**
 * QrCode — render a QR code via react-native-qrcode-svg.
 *
 * Stoop V3 Phase 40.6 (2026-05-08).
 *
 * Single thin wrapper component. The library is straightforward
 * but the wrapper exists so screens can switch implementations
 * later (e.g. fall back to a hand-rolled SVG renderer if the lib
 * goes unmaintained — react-native-qrcode-svg is small enough to
 * fork).
 *
 * Two payload shapes:
 *
 *   <QrCode value="stoop-contact://..." />
 *   <QrCode value={JSON.stringify(invite)} />
 *
 * The caller serialises invite tokens themselves (the Stoop web
 * encodes them with `encodeURIComponent` inside an
 * `?invite=<json>` URL; the mobile QR can just embed the JSON
 * directly, which the substrate's qrScanner handles).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

/**
 * @param {object} args
 * @param {string} args.value          payload to encode
 * @param {number} [args.size=240]     side length in DIPs
 * @param {string} [args.backgroundColor='#fff']
 * @param {string} [args.color='#000']
 */
export function QrCode({ value, size = 240, backgroundColor = '#fff', color = '#000' }) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return (
    <View style={[styles.frame, { backgroundColor, padding: size * 0.04 }]}>
      <QRCode
        value={value}
        size={size}
        backgroundColor={backgroundColor}
        color={color}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems:    'center',
    justifyContent: 'center',
    borderRadius:  8,
  },
});
