/**
 * canopy-chat-mobile v2 — launcher bottom tab bar (board 1/5/6C).
 *
 * Screens / Kringen / Contacten / Mij — the four top-level surfaces. Rendered
 * by the launcher beneath the list, stream and Me screens; absent inside a
 * circle.
 *
 * D / Surface 1 — the tab roster (ids + locale keys) is NO LONGER hardcoded
 * here: it is projected from `manifest.tabs` via the shared `circleTabsMobile`
 * selector (invariants #1/#3 — the four ids + `circle.tab.*` keys live ONCE,
 * in the manifest; web ≡ mobile by construction, both consume the same
 * projection).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { circleTabsMobile } from '../../../../canopy-chat/src/v2/tabProjection.js';
import { canopyChatManifest } from '../../../../canopy-chat/src/index.js';
import { theme } from './theme.js';

export default function CircleTabBar({ active, onSelect }) {
  return (
    <View style={styles.bar} testID="circle-tabbar">
      {circleTabsMobile(canopyChatManifest).map((tab) => {
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
            <Text style={[styles.label, on && styles.labelActive]}>{t(tab.labelKey)}</Text>
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
