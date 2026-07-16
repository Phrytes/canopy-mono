/**
 * **Platform: RN**.  E5 (mobile) — "⤢ Open in full" detail view for a
 * record / mini-page reply.
 *
 * The RN parallel of web's `openContentPanel`: web re-hosts the card in
 * the wide side panel; on a single-column phone the equivalent is a
 * full-height modal sheet giving the fields room to breathe (and to
 * scroll when long).  Read-only — actions stay on the inline bubble.
 *
 * No hardcoded strings — the close label comes through `t`.
 */
import React from 'react';
import {
  Modal, View, ScrollView, Text, TouchableOpacity, StyleSheet, Pressable,
} from 'react-native';

export default function RecordDetailModal({ visible, record, t, onClose }) {
  const fields = Array.isArray(record?.fields) ? record.fields : [];
  return (
    <Modal visible={!!visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="record-detail-modal"
        >
          {record?.title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{record.title}</Text>
            </View>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {fields.map((f, i) => (
              <View key={`${f.name}-${i}`} style={styles.row}>
                <Text style={styles.fieldName}>{f.name}</Text>
                <Text style={styles.fieldValue} selectable>
                  {typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              testID="record-detail-close"
            >
              <Text style={styles.closeBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '92%', minHeight: '50%',
  },
  header: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  title:   { fontSize: 18, fontWeight: '700', color: '#222' },
  list:    { flex: 1 },
  listContent: { padding: 16, gap: 12 },
  row:     { gap: 2 },
  fieldName:  { fontSize: 12, fontWeight: '700', color: '#666' },
  fieldValue: { fontSize: 15, color: '#222' },
  footer: {
    padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
    alignItems: 'flex-end',
  },
  closeBtn: {
    backgroundColor: '#1e88e5', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18,
  },
  closeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
