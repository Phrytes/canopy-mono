/**
 * canopy-chat-mobile v2 — circle Lists (RN mirror of web's openListsPanel, cluster K · K2 container UI).
 *
 * The composable model on mobile: a circle's `list` containers + their `list-item` children, rendered nested
 * via the SAME shared data layer (`makeCircleLists` → `projectContainer`) the web uses — web≡mobile by
 * construction (shared logic, per-platform renderer). "+ add" creates a CONTAINED child; row-actions
 * complete/remove. PERSISTENT via an AsyncStorage-backed DataSource (lists survive a reload); in-memory if
 * AsyncStorage is unavailable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../../core/localisation.js';
import { theme } from './theme.js';
import { makeCircleLists } from '../../../../canopy-chat/src/v2/circleLists.js';
import { buildHouseholdDataSource } from '../../../../household/src/index.js';

export default function CircleListsScreen({ circleId, onBack }) {
  const svcRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [lists, setLists] = useState([]);
  const [openList, setOpenList] = useState(null);   // the opened list row, or null = index
  const [tree, setTree] = useState(null);
  const [newName, setNewName] = useState('');
  const [pendingAdd, setPendingAdd] = useState(null);   // container node id awaiting an inline add
  const [addText, setAddText] = useState('');

  // Build the persistent per-circle service once (AsyncStorage; in-memory fallback).
  useEffect(() => {
    let alive = true;
    (async () => {
      let dataSource;
      try { dataSource = await buildHouseholdDataSource({ dbName: 'cc-circle-lists-cache', asyncStorage: AsyncStorage }); }
      catch { dataSource = undefined; }
      if (!alive) return;
      svcRef.current = makeCircleLists({ dataSource });
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const reloadLists = useCallback(async () => {
    if (svcRef.current) setLists(await svcRef.current.listLists(circleId));
  }, [circleId]);
  const reloadTree = useCallback(async (listId) => {
    if (svcRef.current) setTree(await svcRef.current.tree(circleId, listId));
  }, [circleId]);

  useEffect(() => { if (ready) reloadLists(); }, [ready, reloadLists]);

  const createList = useCallback(async () => {
    const v = newName.trim();
    if (!v || !svcRef.current) return;
    await svcRef.current.createList(circleId, v);
    setNewName('');
    reloadLists();
  }, [newName, circleId, reloadLists]);

  const openOne = useCallback(async (l) => { setOpenList(l); setPendingAdd(null); await reloadTree(l.id); }, [reloadTree]);
  const backToIndex = useCallback(() => { setOpenList(null); setPendingAdd(null); setTree(null); reloadLists(); }, [reloadLists]);

  const submitAdd = useCallback(async () => {
    const v = addText.trim(); const target = pendingAdd;
    setPendingAdd(null); setAddText('');
    if (v && target && svcRef.current && openList) { await svcRef.current.addItem(circleId, target, v); reloadTree(openList.id); }
  }, [addText, pendingAdd, circleId, openList, reloadTree]);

  const onRowAction = useCallback(async (op, node) => {
    if (!svcRef.current || !openList) return;
    if (op === 'markComplete') await svcRef.current.markDone(circleId, node.id);
    else if (op === 'removeItem') await svcRef.current.remove(circleId, node.id);
    reloadTree(openList.id);
  }, [circleId, openList, reloadTree]);

  function renderNode(node, depth) {
    return (
      <View key={node.id}>
        <View style={[styles.node, { marginLeft: depth * 16 }]} testID={`list-node-${node.id}`}>
          <Text style={styles.nodeLabel}>{node.label}</Text>
          {(node.rowActions || []).map((op) => (
            <Chip key={op} label={t(`circle.container.action.${op}`)} onPress={() => onRowAction(op, node)} />
          ))}
          {node.canAdd ? <Chip accent label={t('circle.container.add')} onPress={() => { setPendingAdd(node.id); setAddText(''); }} /> : null}
        </View>
        {(node.children || []).map((c) => renderNode(c, depth + 1))}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="circle-lists">
      <View style={styles.header}>
        <Pressable onPress={openList ? backToIndex : onBack} testID="lists-back"><Text style={styles.back}>‹ {t('circle.lists.title')}</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {!openList ? (
          <>
            {lists.length === 0 ? <Text style={styles.empty}>{t('circle.lists.empty')}</Text> : null}
            {lists.map((l) => (
              <Pressable key={l.id} style={styles.listRow} onPress={() => openOne(l)} testID={`list-row-${l.id}`}>
                <Text style={styles.listRowText}>{l.text}</Text>
              </Pressable>
            ))}
            <View style={styles.newRow}>
              <TextInput
                style={styles.newInput} value={newName} onChangeText={setNewName}
                placeholder={t('circle.lists.new')} placeholderTextColor={theme.color.inkSoft}
                onSubmitEditing={createList} testID="lists-new-input"
              />
              <Pressable style={styles.create} onPress={createList} testID="lists-create"><Text style={styles.createText}>{t('circle.lists.create')}</Text></Pressable>
            </View>
          </>
        ) : (
          <>
            {tree ? renderNode(tree, 0) : null}
            {pendingAdd ? (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput} value={addText} onChangeText={setAddText} autoFocus
                  placeholder={t('circle.lists.add_prompt')} placeholderTextColor={theme.color.inkSoft}
                  onSubmitEditing={submitAdd} testID="lists-add-input"
                />
                <Pressable style={styles.create} onPress={submitAdd} testID="lists-add-submit"><Text style={styles.createText}>{t('circle.lists.create')}</Text></Pressable>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, onPress, accent }) {
  return (
    <Pressable style={[styles.chip, accent && styles.chipAccent]} onPress={onPress}>
      <Text style={[styles.chipText, accent && styles.chipTextAccent]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: theme.color.accent, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  empty: { fontSize: 14, color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 12 },
  listRow: { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.white },
  listRowText: { fontSize: 15, color: theme.color.ink },
  node: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 6 },
  nodeLabel: { flex: 1, fontSize: 15, color: theme.color.ink, minWidth: 120 },
  newRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  newInput: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  create: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  createText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line },
  chipAccent: { borderColor: theme.color.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.inkSoft },
  chipTextAccent: { color: theme.color.accent },
});
