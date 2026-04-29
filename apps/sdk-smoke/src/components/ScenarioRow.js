/**
 * ScenarioRow — one row per scenario stub.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ S1 — Bootstrap & recover         [pending]   Run | Log │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ (LogPane appears here when "Log" is toggled on)         │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Owns the log buffer + status pill for its scenario; calls back into
 * the scenario's `run({ log, sdk })` and reflects the returned status.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LogPane } from './LogPane.js';

const STATUS_COLOR = {
  pending:   '#6b7094',
  running:   '#e0a85c',
  pass:      '#5ce07a',
  fail:      '#e05c5c',
  degraded:  '#e0c45c',
};

export function ScenarioRow({ scenario, sdk }) {
  const [status, setStatus] = useState('pending');
  const [detail, setDetail] = useState('not run yet');
  const [entries, setEntries] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [running, setRunning] = useState(false);

  const log = useCallback((line) => {
    setEntries((prev) => [...prev, { ts: Date.now(), line }]);
  }, []);

  const onRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setStatus('running');
    setDetail('running…');
    setShowLog(true);
    log(`> run() starting`);
    const t0 = Date.now();
    try {
      const res = await scenario.run({ log, sdk });
      const ms = Date.now() - t0;
      const next = res?.status ?? 'pending';
      setStatus(next);
      setDetail(`${res?.detail ?? '(no detail)'}  (${ms}ms)`);
      log(`< run() returned ${next} -- ${res?.detail ?? ''} (${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - t0;
      setStatus('fail');
      setDetail(`threw: ${err?.message ?? String(err)}  (${ms}ms)`);
      log(`! run() threw: ${err?.message ?? String(err)} (${ms}ms)`);
    } finally {
      setRunning(false);
    }
  }, [running, scenario, log, sdk]);

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <View style={styles.titleBlock}>
          <Text style={styles.id}>{scenario.id}</Text>
          <Text style={styles.title}>{scenario.title}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: STATUS_COLOR[status] ?? '#6b7094' }]}>
          <Text style={styles.pillText}>{status}</Text>
        </View>
      </View>

      <Text style={styles.detail} numberOfLines={2}>{detail}</Text>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnRun, pressed && styles.btnPressed, running && styles.btnDisabled]}
          onPress={onRun}
          disabled={running}
        >
          <Text style={styles.btnText}>{running ? 'Running…' : 'Run'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnLog, pressed && styles.btnPressed]}
          onPress={() => setShowLog((v) => !v)}
        >
          <Text style={styles.btnText}>{showLog ? 'Hide log' : 'Show log'}</Text>
        </Pressable>
      </View>

      {showLog && <LogPane entries={entries} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row:         { backgroundColor: '#1a1d27', borderRadius: 8, padding: 12, marginBottom: 10 },
  head:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleBlock:  { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  id:          { color: '#8c93b8', fontSize: 13, fontWeight: '700', minWidth: 28 },
  title:       { color: '#d4d8f0', fontSize: 14, flexShrink: 1 },
  pill:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginLeft: 8 },
  pillText:    { color: '#0f1117', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  detail:      { color: '#6b7094', fontSize: 12, marginTop: 6 },
  actions:     { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  btnRun:      { backgroundColor: '#3b4670' },
  btnLog:      { backgroundColor: '#262a36' },
  btnPressed:  { opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: '#d4d8f0', fontSize: 13, fontWeight: '600' },
});
