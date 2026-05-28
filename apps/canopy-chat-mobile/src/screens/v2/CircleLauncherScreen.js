/**
 * canopy-chat-mobile v2 — circle launcher screen (board 1B).
 *
 * Mobile counterpart of web's `web/v2/circleLauncher.js`, over the same
 * shared model (`loadCircles` / `circleSourcesFromAgent` from
 * '@canopy-app/canopy-chat'). Additive: ChatScreen is untouched; App.js
 * shows this when the user toggles to "Circles".
 *
 * Data: if a `bundle` (with `callSkill`) is passed, real circles load via
 * the shared sources; otherwise the launcher renders its empty state. The
 * bundle is not yet lifted to App level, so live data + opening a circle
 * (F1 scoping) land in the next slice — flagged for device verification.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { loadCircles, circleSourcesFromAgent } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleLauncherScreen({ bundle, onBack, onOpenCircle, onNewCircle }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = bundle?.callSkill
        ? circleSourcesFromAgent({
            callSkill: (opId, args) => bundle.callSkill('stoop', opId, args),
            circlesStore: bundle.circlesStore,
          })
        : {};
      setCircles(await loadCircles(sources));
    } catch {
      setCircles([]);
    } finally {
      setLoading(false);
    }
  }, [bundle]);

  useEffect(() => { load(); }, [load]);

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
                onPress={() => onOpenCircle && onOpenCircle(c.id, c)}
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
