/**
 * canopy-chat-mobile v2 — circle launcher + detail screen (boards 1B / F1).
 *
 * Mobile counterpart of web's circleLauncher + circleDetail + circleApp,
 * over the same shared model ('@canopy-app/canopy-chat'). The launcher is
 * the app's default screen; the classic ChatScreen stays reachable via
 * "← chat". Opening a circle sets the active circle (F1) and shows an
 * inline scoped detail; "+ new circle" creates one via the existing
 * createGroupV2 path and refreshes.
 *
 * Data: with a `bundle` (callSkill) real circles + items + create work via
 * the shared helpers; otherwise the empty states show + create is a no-op.
 * Flagged for device verification.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, quickCreateCircle, setActiveCircle,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleLauncherScreen({ bundle, onBack }) {
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const callSkill = useMemo(
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, circlesStore: bundle?.agent?.circlesStore })
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
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); };

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !bundle?.callSkill) { setCreating(false); setNewName(''); return; }
    try {
      await quickCreateCircle({ callSkill: bundle.callSkill, name });
    } catch { /* surfaced by reload showing no new circle */ }
    setCreating(false);
    setNewName('');
    load();
  }, [newName, bundle, load]);

  if (selected) {
    return <CircleDetail circle={selected} items={items} onBack={closeCircle} />;
  }

  return (
    <View style={styles.page} testID="circle-launcher">
      <View style={styles.bar}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" testID="circle-to-chat">
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

          {creating ? (
            <View style={styles.createRow}>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('circle.new')}
                autoFocus
                onSubmitEditing={submitCreate}
                returnKeyType="done"
              />
              <Pressable style={styles.createBtn} accessibilityRole="button" onPress={submitCreate}>
                <Text style={styles.createBtnText}>✓</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={styles.newBtn}
              accessibilityRole="button"
              onPress={() => setCreating(true)}
            >
              <Text style={styles.newText}>{t('circle.new')}</Text>
            </Pressable>
          )}
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
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:        { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:       { fontSize: 13, color: '#6a6a6a' },
  title:      { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  list:       { gap: 6, paddingBottom: 32 },
  tile:       { padding: 13, borderWidth: 1, borderColor: '#e6e0cf', borderRadius: 8, backgroundColor: '#fbf8ed' },
  tileName:   { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  tileMeta:   { fontSize: 11, color: '#6a6a6a', marginTop: 2 },
  muted:      { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
  newBtn:     { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#d8d2c0', borderRadius: 8, alignItems: 'center' },
  newText:    { color: '#6a6a6a' },
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: '#c9a13a', borderRadius: 8, backgroundColor: '#fff', fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: '#c9a13a', alignItems: 'center' },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
