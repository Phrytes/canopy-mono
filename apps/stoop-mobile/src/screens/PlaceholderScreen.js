/**
 * PlaceholderScreen — fills in for screens that are still TODO in
 * Phase 40.10.  Renders the route name + a one-line description so
 * the navigation stack works end-to-end while we fill in the real
 * screens incrementally.
 *
 * Each screen file replaces this default export as it ships; the
 * navigation stack picks up the new export on next app reload.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';

export function PlaceholderScreen({ route }) {
  const name = route?.name ?? 'unknown';
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.subtitle}>Stoop V3 — work in progress (Phase 40.10).</Text>
      </View>
    </View>
  );
}

export default PlaceholderScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADII.md,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.text,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
});
