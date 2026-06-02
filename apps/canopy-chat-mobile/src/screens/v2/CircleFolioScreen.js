/**
 * canopy-chat-mobile v2 — circle-scoped Folio file browser (RN screen,
 * board 10B).
 *
 * RN counterpart of web's circleFolio over the SAME shared model
 * (`buildCircleFiles`): a drive-like view onto a circle's shared pod,
 * scoping a flat file list to the active circle and listing the rows
 * newest-first.  Empty state when the circle's drive has no files; else a
 * scrollable list of file rows.
 *
 * N5 — the projected (circle-scoped / share-filtered) row list is fed
 * through Folio's source-agnostic `folioLevel` into a Drive view: a
 * breadcrumb trail, the immediate subfolders (with counts), and the
 * files directly in the current folder.  Folder rows descend; breadcrumbs
 * climb out; file rows are rich (kind glyph + human size).  Mirrors the
 * web renderer in apps/canopy-chat/web/v2/circleFolio.js.
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
  // N5 — Drive tree helpers (source-agnostic; pure, node-free).
  folioLevel, glyphForFile, formatFileSize,
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
  const [currentPath, setCurrentPath] = useState('');   // N5 — folder being viewed

  const rows = useMemo(() => {
    if (shareFilter && Array.isArray(rawFiles)) {
      return buildSharedFiles({
        files: rawFiles, myId: null, myCircles, filter: shareFilter,
      });
    }
    return buildCircleFiles({ files, circleId });
  }, [files, rawFiles, circleId, myCircles, shareFilter]);

  // Drive level at the current folder, derived purely from the row paths.
  const level = useMemo(() => folioLevel(rows, currentPath), [rows, currentPath]);

  // Changing the row set (share toggle) resets folder depth.
  const onShare = (key) => {
    setShareFilter(shareFilter === key ? null : key);
    setCurrentPath('');
  };

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
              onPress={() => onShare(key)}
              style={[styles.sharePill, shareFilter === key && styles.sharePillActive]}
            >
              <Text style={[styles.sharePillText, shareFilter === key && styles.sharePillTextActive]}>
                {t(`circle.folio.${key.replace(/-/g, '_')}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* N5 — breadcrumb trail (root crumb gets a friendly label) */}
      <View style={styles.crumbs} testID="circle-folio-crumbs">
        {level.crumbs.map((crumb, i) => {
          const label = crumb.name || t('circle.folio.root');
          const isLast = i === level.crumbs.length - 1;
          return (
            <View key={crumb.path || '__root'} style={styles.crumbWrap}>
              {isLast ? (
                <Text style={styles.crumbCurrent} accessibilityRole="header">{label}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  testID={`circle-folio-crumb-${crumb.path || 'root'}`}
                  onPress={() => setCurrentPath(crumb.path)}
                >
                  <Text style={styles.crumb}>{label}</Text>
                </Pressable>
              )}
              {!isLast ? <Text style={styles.crumbSep}>/</Text> : null}
            </View>
          );
        })}
      </View>

      {level.folders.length === 0 && level.files.length === 0 ? (
        <Text style={styles.muted}>
          {t(currentPath ? 'circle.folio.empty_folder' : emptyKeyFor(shareFilter))}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {level.folders.map((folder) => (
            <Pressable
              key={`d:${folder.path}`}
              style={styles.row}
              accessibilityRole="button"
              testID={`folio-folder-${folder.path}`}
              onPress={() => setCurrentPath(folder.path)}
            >
              <Text style={styles.glyph}>📁</Text>
              <Text style={[styles.name, styles.folderName]} numberOfLines={1}>{folder.name}</Text>
              <Text style={styles.meta}>{t('circle.folio.folder_count', { count: folder.count })}</Text>
            </Pressable>
          ))}
          {level.files.map((file) => {
            const size = formatFileSize(typeof file.bytes === 'number' ? file.bytes : file.size);
            return (
              <Pressable
                key={file.id}
                style={styles.row}
                accessibilityRole="button"
                testID={`folio-row-${file.id}`}
                onPress={() => onOpen?.(file)}
              >
                <Text style={styles.glyph}>{glyphForFile(file.name)}</Text>
                <Text style={styles.name} numberOfLines={1}>{file.name}</Text>
                {size ? <Text style={styles.meta}>{size}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/** Share-filter-specific empty copy at the root (matches web). */
function emptyKeyFor(shareFilter) {
  if (shareFilter === 'shared-by-me') return 'circle.folio.shared_by_me_empty';
  if (shareFilter === 'shared-with-me') return 'circle.folio.shared_with_me_empty';
  return 'circle.folio.empty';
}

const styles = StyleSheet.create({
  page:   { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:    { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:   { fontSize: 13, color: theme.color.inkSoft },
  title:  { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:   { gap: 6, paddingBottom: 32 },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  glyph:  { fontSize: 16 },
  name:   { fontSize: 14, color: theme.color.ink, flexShrink: 1 },
  folderName: { fontWeight: '700' },
  meta:   { marginLeft: 'auto', fontSize: 12, color: theme.color.inkSoft },
  muted:  { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  crumbs:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingVertical: 8 },
  crumbWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumb:        { fontSize: 13, color: theme.color.accent },
  crumbCurrent: { fontSize: 13, fontWeight: '700', color: theme.color.ink },
  crumbSep:     { fontSize: 13, color: theme.color.inkSoft },
  shareRow:          { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  sharePill:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  sharePillActive:   { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  sharePillText:     { fontSize: 13, color: theme.color.ink },
  sharePillTextActive:{ color: theme.color.paper, fontWeight: '600' },
});
