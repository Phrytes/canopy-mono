/**
 * canopy-chat-mobile v2 — circle launcher + detail screen (boards 1B / F1).
 *
 * Mobile counterpart of web's circleLauncher + circleDetail + circleApp,
 * over the same shared model ('@canopy-app/canopy-chat'). Additive:
 * ChatScreen is untouched; App.js shows this when the user toggles to
 * "Circles". Opening a circle sets the active circle (F1) and shows an
 * inline scoped detail populated with that circle's items; back returns
 * to the launcher.
 *
 * Data: with a `bundle` (callSkill) real circles + items load via the
 * shared sources/content helpers; otherwise the empty states show.
 * Flagged for device verification.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, setActiveCircle,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleLauncherScreen({ bundle, onBack, onNewCircle }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);

  const callSkill = useMemo(
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, circlesStore: bundle?.circlesStore })
        : {};
      setCircles(await loadCircles(sources));
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, [callSkill, bundle]);

  useEffect(() => { load(); }, [load]);

  const openCircle = useCallback(async (c) => {
    setActiveCircle(c.id);
    setSelected(c);
    setItems([]);
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      // only paint if still on this circle
      setSelected((cur) => {
        if (cur && cur.id === c.id) setItems(got);
        return cur;
      });
    } catch { /* keep empty */ }
  }, [callSkill]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); };

  if (selected) {
    return <CircleDetail circle={selected} items={items} onBack={closeCircle} />;
  }

  return (
    <View style={styles.page}>
      <View style={styles.bar}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button">
            <Text style={styles.back}>← chat</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.title}>{t('circle.title')}</Text>

      {loading ? (
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {circles.length === 0 ? (
            <Text style={styles.muted}>{t('circle.empty')}</Text>
          ) : (
            circles.map((c) => (
              <Pressable
                key={c.id}
                style={styles.tile}
                accessibilityRole="button"
                onPress={() => openCircle(c)}
              >
                <Text style={styles.tileName}>{c.name}</Text>
                {c.memberCount != null ? (
                  <Text style={styles.tileMeta}>{t('circle.members', { count: c.memberCount })}</Text>
                ) : null}
              </Pressable>
            ))
          )}

          <Pressable
            style={styles.newBtn}
            accessibilityRole="button"
            onPress={() => onNewCircle && onNewCircle()}
          >
            <Text style={styles.newText}>{t('circle.new')}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function CircleDetail({ circle, items, onBack }) {
  return (
    <View style={styles.page}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{circle.name || circle.id}</Text>
      {circle.memberCount != null ? (
        <Text style={styles.tileMeta}>{t('circle.members', { count: circle.memberCount })}</Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {(!items || items.length === 0) ? (
          <Text style={styles.muted}>{t('circle.detail_empty')}</Text>
        ) : (
          items.map((it, i) => (
            <View key={it.id ?? i} style={styles.tile}>
              <Text style={styles.tileName}>
                {it.label || it.title || it.text || it.name || String(it.id ?? '')}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page:     { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:      { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:     { fontSize: 13, color: '#6a6a6a' },
  title:    { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  list:     { gap: 6, paddingBottom: 32 },
  tile:     { padding: 13, borderWidth: 1, borderColor: '#e6e0cf', borderRadius: 8, backgroundColor: '#fbf8ed' },
  tileName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  tileMeta: { fontSize: 11, color: '#6a6a6a', marginTop: 2 },
  muted:    { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
  newBtn:   { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#d8d2c0', borderRadius: 8, alignItems: 'center' },
  newText:  { color: '#6a6a6a' },
});
