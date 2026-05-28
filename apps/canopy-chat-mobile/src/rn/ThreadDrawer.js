/**
 * ThreadDrawer — left-slide drawer that lists threads + lets the
 * user switch active OR create a new one (#253 step 5).
 *
 * Pure RN component; business logic lives in
 * `src/core/threadState.js`.  Callers wire:
 *   - threads          listThreads(state)
 *   - activeThreadId   state.activeThreadId
 *   - visible          drawer open/closed
 *   - onClose          dismiss handler
 *   - onSwitchThread   (id: string) => void
 *   - onCreateThread   (name: string) => void
 *
 * No hardcoded strings ([[no-hardcoded-strings]]) — every label
 * via `t()`.
 */
import React, { useState, useCallback } from 'react';
import {
  Modal, Pressable, View, Text, FlatList, TouchableOpacity,
  TextInput, StyleSheet, Platform,
} from 'react-native';

import { t } from '../core/localisation.js';

export default function ThreadDrawer({
  threads,
  activeThreadId,
  visible,
  onClose,
  onSwitchThread,
  onCreateThread,
}) {
  const [newName, setNewName] = useState('');

  const onCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    onCreateThread?.(name);
    setNewName('');
  }, [newName, onCreateThread]);

  const renderRow = useCallback(({ item }) => {
    const isActive = item.id === activeThreadId;
    return (
      <TouchableOpacity
        onPress={() => onSwitchThread?.(item.id)}
        style={[styles.row, isActive && styles.rowActive]}
        accessibilityRole="button"
        accessibilityLabel={`thread-row-${item.id}`}
        testID={`thread-row-${item.id}`}
      >
        <Text style={[styles.rowName, isActive && styles.rowNameActive]}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>
          {t('threads.message_count', { count: item.messages?.length ?? 0 })}
        </Text>
      </TouchableOpacity>
    );
  }, [activeThreadId, onSwitchThread]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.drawer}
          onPress={(e) => e.stopPropagation()}
          testID="thread-drawer"
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('threads.drawer_title')}</Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="thread-drawer-close"
              testID="thread-drawer-close"
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>×</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={threads}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
          />

          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('threads.new_placeholder')}
              autoCapitalize="sentences"
              autoCorrect
              onSubmitEditing={onCreate}
              returnKeyType="done"
              testID="thread-drawer-new-input"
            />
            <TouchableOpacity
              onPress={onCreate}
              disabled={!newName.trim()}
              style={[
                styles.createBtn,
                !newName.trim() && styles.createBtnDisabled,
              ]}
              accessibilityRole="button"
              testID="thread-drawer-new-submit"
            >
              <Text style={styles.createBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    flexDirection: 'row',
  },
  drawer: {
    width: '78%',
    maxWidth: 360,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
    paddingBottom: 16,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 2, height: 0 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 4, minWidth: 32, alignItems: 'center' },
  closeBtnText: { fontSize: 24, color: '#666', lineHeight: 24 },

  list: { flex: 1 },
  row: {
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  rowActive: { backgroundColor: '#e6f0ff' },
  rowName: { fontSize: 15, color: '#222', fontWeight: '500' },
  rowNameActive: { color: '#1e88e5', fontWeight: '700' },
  rowMeta: { fontSize: 12, color: '#888', marginTop: 2 },

  createRow: {
    flexDirection: 'row',
    paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 8,
  },
  createInput: {
    flex: 1, borderWidth: 1, borderColor: '#ccc',
    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14,
  },
  createBtn: {
    backgroundColor: '#1e88e5',
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  createBtnDisabled: { backgroundColor: '#ccc' },
  createBtnText: { color: '#fff', fontSize: 22, lineHeight: 24 },
});
