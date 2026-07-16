/**
 * SlashFAB — bottom-right "/" floating action button for the
 * basis-mobile primary screens (#241, 2026-05-24).
 *
 * Tap the FAB → opens a modal with a TextInput (slash entry) +
 * a FlatList showing matches from the lifted slashFilter.  Tap a
 * match → it's inserted into the input; press the submit button →
 * `props.onDispatch(commandLine)` fires.  The bundle's callSkill
 * handles the actual dispatch.
 *
 * Conventions:
 *   - Pure RN component (no business logic; logic lives in the
 *     portable slashFilter helper).
 *   - All user-facing strings via `t()` from src/core/localisation.
 *   - Default-visible (per the #241 decision).  Hide via the
 *     `visible` prop if a future settings toggle wants to opt out.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput, FlatList,
  StyleSheet, Pressable,
} from 'react-native';

import { filterSlashSuggestions } from '../core/slashFilter.js';
import { t }                       from '../core/localisation.js';

/**
 * @param {object}   props
 * @param {object}   props.catalog                merged catalog (from composeManifests())
 * @param {function} props.onDispatch             (commandLine: string) => Promise<any>
 * @param {boolean}  [props.visible=true]         render the FAB (false to opt out)
 */
export default function SlashFAB({ catalog, onDispatch, visible = true }) {
  const [open, setOpen]         = useState(false);
  const [input, setInput]       = useState('/');
  const [busy, setBusy]         = useState(false);

  const matches = useMemo(
    () => filterSlashSuggestions({ input, catalog }),
    [input, catalog],
  );

  const close = useCallback(() => {
    setOpen(false);
    setInput('/');
  }, []);

  const submit = useCallback(async () => {
    const line = input.trim();
    if (!line || !line.startsWith('/')) return;
    setBusy(true);
    try {
      await onDispatch?.(line);
      close();
    } catch (err) {
      // Surface inline — keep modal open so user can retry.
      // V0 keeps it minimal; the bundle's callSkill already wraps
      // errors in {ok: false, error}.
      // eslint-disable-next-line no-console
      console.warn('[SlashFAB] dispatch failed', err);
    } finally {
      setBusy(false);
    }
  }, [input, onDispatch, close]);

  const onPickMatch = useCallback((cmd) => {
    setInput(cmd + ' ');
  }, []);

  if (!visible) return null;

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('slash.fab_a11y')}
        onPress={() => setOpen(true)}
        style={styles.fab}
        activeOpacity={0.75}
      >
        <Text style={styles.fabText}>/</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <TextInput
              autoFocus
              value={input}
              onChangeText={setInput}
              placeholder={t('slash.modal_placeholder')}
              style={styles.input}
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="send"
            />

            <FlatList
              data={matches}
              keyExtractor={(m) => m.command}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => onPickMatch(item.command)}
                  style={styles.matchRow}
                >
                  <Text style={styles.matchCmd}>{item.command}</Text>
                  {item.hint
                    ? <Text style={styles.matchHint}>{item.hint}</Text>
                    : null}
                </TouchableOpacity>
              )}
              style={styles.matchList}
            />

            <View style={styles.actions}>
              <TouchableOpacity onPress={close} style={styles.btnSecondary} disabled={busy}>
                <Text>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submit} style={styles.btnPrimary} disabled={busy}>
                <Text style={styles.btnPrimaryText}>{t('common.send')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    // Positioned ABOVE the input bar (#253 step 1 added a fixed
    // bottom TextInput + Send) so the FAB doesn't overlap the
    // Send button.  2026-05-26 Detox debugging caught this when
    // tap('chat-send') was actually hitting the FAB.
    position: 'absolute', right: 16, bottom: 80,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1e88e5',
    justifyContent: 'center', alignItems: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '600' },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12,
    padding: 12, paddingBottom: 24, maxHeight: '80%',
  },
  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
    fontFamily: 'monospace',
  },
  matchList: { marginTop: 8, maxHeight: 280 },
  matchRow: { paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  matchCmd: { fontFamily: 'monospace', fontSize: 14 },
  matchHint: { color: '#666', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 8 },
  btnSecondary: { padding: 10 },
  btnPrimary: { backgroundColor: '#1e88e5', padding: 10, borderRadius: 6, paddingHorizontal: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
});
