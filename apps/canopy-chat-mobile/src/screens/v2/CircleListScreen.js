/**
 * CircleListScreen — B · Slice 3 mobile list surface (web≡mobile via the shared buildScreenModel).
 *
 * A search box + category chips + the filtered rows, each with capability-gated action buttons
 * (greyed/hidden per Slice 4). Owns query + activeCategories locally; typing re-filters the rows
 * (the TextInput stays mounted → keeps focus). Mirrors the web renderListBlock.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { buildScreenModel } from '../../../../canopy-chat/src/v2/screenModel.js';
import { t } from '../../core/localisation.js';

export default function CircleListScreen({
  items = [], categoryField, manifestsByOrigin, appOrigin, capabilityMatrix = [],
  title, onRowAction, onClose,
}) {
  const [query, setQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState(null);   // null = all checked

  const shared = { items, categoryField, manifestsByOrigin, appOrigin, capabilityMatrix };
  const model = useMemo(() => buildScreenModel({ ...shared, query, activeCategories }),
    [items, categoryField, appOrigin, capabilityMatrix, query, activeCategories]);
  const allCats = useMemo(() => buildScreenModel(shared).categories, [items, categoryField, appOrigin, capabilityMatrix]);

  const toggleCat = (id, checked) => {
    const base = activeCategories == null ? allCats.map((c) => c.id) : activeCategories;
    const set = new Set(base);
    if (checked) set.add(id); else set.delete(id);
    setActiveCategories([...set]);
  };
  const isChecked = (id) => activeCategories == null || activeCategories.includes(id);

  return (
    <View style={styles.page} testID="circle-list-screen">
      <View style={styles.bar}>
        <Text style={styles.title}>{title || ''}</Text>
        {onClose ? (
          <Pressable onPress={onClose} accessibilityRole="button" testID="list-screen-close">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <TextInput
        style={styles.search}
        placeholder={t('circle.screen.filter_placeholder')}
        placeholderTextColor={theme.color.inkSoft}
        value={query}
        onChangeText={setQuery}
        testID="list-screen-search"
      />

      {allCats.length ? (
        <View style={styles.chipRow}>
          {allCats.map((c) => {
            const on = isChecked(c.id);
            return (
              <Pressable key={c.id} onPress={() => toggleCat(c.id, !on)}
                style={[styles.chip, on && styles.chipOn]} testID={`list-screen-cat-${c.id}`}>
                <Text style={styles.chipText}>{`${c.id} (${c.count})`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {model.rows.length === 0 ? (
          <Text style={styles.muted}>{t('circle.screen.empty')}</Text>
        ) : model.rows.map((row) => (
          <View key={row.item?.id ?? row.label} style={styles.row} testID={`list-screen-row-${row.item?.id ?? ''}`}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            {(row.actions || []).map((a) => (
              <Pressable key={a.id} disabled={!!a.disabled}
                onPress={() => { if (!a.disabled && typeof onRowAction === 'function') onRowAction({ opId: a.opId, itemId: a.itemId }); }}
                style={[styles.action, a.disabled && styles.actionGreyed]}
                testID={`list-screen-action-${a.opId}-${a.itemId}`}>
                <Text style={styles.actionText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 26 },
  title:       { fontSize: 20, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink },
  close:       { fontSize: 18, color: theme.color.inkSoft, paddingHorizontal: 6 },
  search:      { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8, color: theme.color.ink },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip:        { borderWidth: 1, borderColor: theme.color.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.color.paper },
  chipOn:      { borderColor: theme.color.accent, backgroundColor: theme.color.card },
  chipText:    { fontSize: 12, color: theme.color.ink },
  body:        { paddingVertical: 10, paddingBottom: 24 },
  row:         { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  rowLabel:    { fontSize: 15, color: theme.color.ink, flexGrow: 1 },
  action:      { borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.color.card },
  actionGreyed:{ opacity: 0.4, borderColor: theme.color.line, backgroundColor: theme.color.paper },
  actionText:  { fontSize: 13, color: theme.color.accent },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 12 },
});
