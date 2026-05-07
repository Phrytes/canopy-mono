/**
 * AvatarCircle — round avatar for users.  Renders the photo when one
 * is provided, otherwise a circle with the user's initials over a
 * deterministic background colour.
 *
 * Stoop V3 — used by ProfileMine, ProfileOther, ChatThread headers,
 * Contacts list rows, GroupScreen member chips.
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS, FONT_SIZES } from '../lib/theme.js';
import { initials as _initialsFn, paletteFor } from '../lib/avatar.js';

export function AvatarCircle({ uri, name = '', size = 48, style }) {
  const initials = _initialsFn(name);
  const bg       = paletteFor(name);
  const dim      = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, dim, style]}
        accessibilityLabel={name || undefined}
      />
    );
  }

  return (
    <View
      style={[styles.fallback, dim, { backgroundColor: bg }, style]}
      accessibilityLabel={name || undefined}
    >
      <Text style={[styles.initials, { fontSize: size * 0.42 }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: COLORS.surfaceMuted,
  },
  fallback: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  initials: {
    color:      COLORS.textInverse,
    fontWeight: '600',
    fontSize:   FONT_SIZES.md,
  },
});
