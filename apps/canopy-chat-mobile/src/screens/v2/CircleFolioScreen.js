/**
 * canopy-chat-mobile v2 — circle-scoped Folio file browser (RN screen,
 * board 10B).
 *
 * RN counterpart of web's circleFolio over the SAME shared model
 * (`buildCircleFiles`): a drive-like view onto a circle's shared pod,
 * scoping a flat file list to the active circle and listing the rows
 * newest-first.  Empty state when the circle's drive has no files; else a
 * scrollable list of file rows.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import {
  buildCircleFiles,
  // P6.M8 #350 — share-toggle re-projects the raw list through the
  // sharedFilters substrate.  `rawFiles` carries the un-projected list
  // so we can swap projectors without a refetch.
  buildSharedFiles, FOLIO_SHARE_FILTERS,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleFolioScreen({
  files = [],
  rawFiles = null,
  circleId = null,
  myCircles = [],
  onBack,
  onOpen,
}) {
  const [shareFilter, setShareFilter] = useState(null);

  const rows = useMemo(() => {
    if (shareFilter && Array.isArray(rawFiles)) {
      return buildSharedFiles({
        files: rawFiles, myId: null, myCircles, filter: shareFilter,
      });
    }
    return buildCircleFiles({ files, circleId });
  }, [files, rawFiles, circleId, myCircles, shareFilter]);

  const emptyKey = shareFilter === 'shared-by-me'
    ? 'circle.folio.shared_by_me_empty'
    : shareFilter === 'shared-with-me'
      ? 'circle.folio.shared_with_me_empty'
      : 'circle.folio.empty';

  return (
    <View style={styles.page} testID="circle-folio">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-folio-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.folio.title')}</Text>

      {Array.isArray(rawFiles) ? (
        <View style={styles.shareRow} testID="circle-folio-share-toggle">
          {FOLIO_SHARE_FILTERS.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              testID={`circle-folio-share-${key}`}
              onPress={() => setShareFilter(shareFilter === key ? null : key)}
              style={[styles.sharePill, shareFilter === key && styles.sharePillActive]}
            >
              <Text style={[styles.sharePillText, shareFilter === key && styles.sharePillTextActive]}>
                {t(`circle.folio.${key.replace(/-/g, '_')}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Text style={styles.muted}>{t(emptyKey)}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((file) => (
            <Pressable
              key={file.id}
              style={styles.row}
              accessibilityRole="button"
              testID={`folio-row-${file.id}`}
              onPress={() => onOpen?.(file)}
            >
              <Text style={styles.name}>{file.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page:   { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:    { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:   { fontSize: 13, color: theme.color.inkSoft },
  title:  { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:   { gap: 6, paddingBottom: 32 },
  row:    { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  name:   { fontSize: 14, color: theme.color.ink },
  muted:  { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  shareRow:          { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  sharePill:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  sharePillActive:   { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  sharePillText:     { fontSize: 13, color: theme.color.ink },
  sharePillTextActive:{ color: theme.color.paper, fontWeight: '600' },
});
