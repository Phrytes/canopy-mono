/**
 * canopy-chat-mobile v2 — launcher bottom tab bar (board 1/5/6C).
 *
 * Kringen / Stroom / Mij — the three top-level surfaces. Rendered by the
 * launcher beneath the list, stream and Me screens; absent inside a circle.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { theme } from './theme.js';

// α.3 — Schermen is the new primary tab (Q6).  Stroom is retired —
// its behaviour now lives as the seeded "Stream" screen.
const TABS = [
  { id: 'screens',   key: 'circle.tab.screens' },
  { id: 'kringen',   key: 'circle.tab.kringen' },
  // P5 — Contacten: the bot/peer roster + their 1:1 DM threads.
  { id: 'contacten', key: 'circle.tab.contacten' },
  { id: 'mij',       key: 'circle.tab.mij' },
];

export default function CircleTabBar({ active, onSelect }) {
  return (
    <View style={styles.bar} testID="circle-tabbar">
      {TABS.map((tab) => {
        const on = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            style={[styles.tab, on && styles.tabActive]}
            onPress={() => onSelect?.(tab.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`circle-tab-${tab.id}`}
          >
            <Text style={[styles.label, on && styles.labelActive]}>{t(tab.key)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'center', gap: 4,
    paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10,
    backgroundColor: theme.color.paper,
    borderTopWidth: 1, borderTopColor: theme.color.line,
  },
  tab: {
    flex: 1, maxWidth: 200, alignItems: 'center',
    paddingVertical: 9, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  tabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  label: { fontSize: 14, fontWeight: '600', color: theme.color.inkSoft },
  labelActive: { color: theme.color.white },
});
