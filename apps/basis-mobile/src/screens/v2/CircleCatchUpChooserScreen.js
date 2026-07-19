/**
 * basis-mobile v2 — ε.6: multi-offer catch-up chooser modal.
 *
 * RN counterpart of web's `catchUpChooserModal.js`.  Pure controlled
 * component: ChatScreen owns the offers array + the resolver Promise,
 * this screen calls `onResolve({accept: {offerFrom, mode}})` or
 * `onResolve({decline: true})` and lets the host close itself.
 *
 * Mirrors γ.3's `CircleRecipeConflictScreen` — RN <Modal transparent>
 * with a Pressable backdrop that dismisses (= decline).
 *
 * Locale namespace (extends ε.5 `circle.chat.catch_up.*`):
 *   - chooser_title             — modal heading
 *   - chooser_subtitle          — "{{count}} sources offered..."
 *   - chooser_msg_count         — "{{count}} messages"
 *   - chooser_size_kb           — "~{{kb}} KB"
 *   - chooser_recent            — "most recent {{when}}"
 *   - chooser_all / chooser_last_50 / chooser_last_7d
 *   - chooser_cancel
 *   - chooser_unknown_provider  — fallback display name
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {Array<{from: string, offer: {requestId, count, sizeBytes, lastTs}}>} props.offers
 * @param {string} props.circleId
 * @param {string} [props.circleName]
 * @param {(peerAddr: string) => ({displayName?: string}|null)} [props.resolveContact]
 * @param {(decision: object) => void} props.onResolve
 * @param {number} [props.nowMs]
 */
export default function CircleCatchUpChooserScreen({
  visible = true,
  offers = [],
  circleId,
  circleName,
  resolveContact = null,
  onResolve,
  nowMs,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const resolved = typeof onResolve === 'function' ? onResolve : () => {};

  const settle = (decision) => {
    try { resolved(decision); } catch { /* host decides */ }
  };
  const decline = () => settle({ decline: true });

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={decline}>
      <Pressable style={styles.backdrop} onPress={decline} testID="catch-up-chooser-backdrop">
        {/* Inner Pressable swallows taps so the sheet doesn't dismiss. */}
        <Pressable style={styles.sheet} onPress={() => {}} testID="catch-up-chooser-sheet">
          <Text style={styles.title}>
            {t('circle.chat.catch_up.chooser_title', { kring: circleName ?? circleId })}
          </Text>
          <Text style={styles.subtitle}>
            {t('circle.chat.catch_up.chooser_subtitle', { count: offers.length })}
          </Text>

          <ScrollView contentContainerStyle={styles.body}>
            {offers.map((o) => {
              const displayName = resolveDisplayName(o.from, resolveContact);
              const offer = o.offer ?? {};
              const count = Number.isFinite(offer.count) ? offer.count : 0;
              const kb    = Math.max(1, Math.round((Number.isFinite(offer.sizeBytes) ? offer.sizeBytes : 0) / 1024));
              const when  = formatRelativeTs(offer.lastTs, now);
              return (
                <View key={`offer-${o.from}`} style={styles.card} testID={`catch-up-chooser-card-${o.from}`}>
                  <Text style={styles.cardName}>{displayName}</Text>
                  <Text style={styles.cardStats}>
                    {`${t('circle.chat.catch_up.chooser_msg_count', { count })} · `
                      + `${t('circle.chat.catch_up.chooser_size_kb',   { kb })} · `
                      + `${t('circle.chat.catch_up.chooser_recent',    { when })}`}
                  </Text>
                  <View style={styles.picker}>
                    {[
                      { mode: 'all',         labelKey: 'circle.chat.catch_up.chooser_all' },
                      { mode: 'last-50',     labelKey: 'circle.chat.catch_up.chooser_last_50' },
                      { mode: 'last-7-days', labelKey: 'circle.chat.catch_up.chooser_last_7d' },
                    ].map((m) => (
                      <Pressable
                        key={m.mode}
                        style={styles.modeBtn}
                        onPress={() => settle({ accept: { offerFrom: o.from, mode: m.mode } })}
                        accessibilityRole="button"
                        testID={`catch-up-chooser-${o.from}-${m.mode}`}
                      >
                        <Text style={styles.modeBtnText}>{t(m.labelKey)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.cancel}
              onPress={decline}
              accessibilityRole="button"
              testID="catch-up-chooser-cancel"
            >
              <Text style={styles.cancelText}>{t('circle.chat.catch_up.chooser_cancel')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function resolveDisplayName(addr, resolveContact) {
  let displayName = null;
  try {
    if (typeof resolveContact === 'function') {
      const c = resolveContact(addr);
      if (c && typeof c.displayName === 'string' && c.displayName) displayName = c.displayName;
    }
  } catch { /* defensive */ }
  if (displayName) return displayName;
  if (typeof addr !== 'string' || addr.length === 0) return t('circle.chat.catch_up.chooser_unknown_provider');
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function formatRelativeTs(ts, now) {
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d   < 7)   return `${d}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return `${d}d ago`; }
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:      { backgroundColor: theme.color.card, borderColor: theme.color.line, borderWidth: 1, borderRadius: 10, padding: 18, maxWidth: 520, width: '100%', maxHeight: '85%' },
  title:      { fontSize: 18, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginBottom: 4 },
  subtitle:   { fontSize: 13, color: theme.color.inkSoft, marginBottom: 14 },
  body:       { paddingBottom: 12 },
  card:       { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  cardName:   { fontWeight: '600', fontSize: 14, color: theme.color.ink, marginBottom: 4 },
  cardStats:  { fontSize: 12, color: theme.color.inkSoft, marginBottom: 8 },
  picker:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modeBtn:    { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, backgroundColor: theme.color.card },
  modeBtnText:{ fontSize: 13, color: theme.color.ink },
  footer:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.color.line },
  cancel:     { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8 },
  cancelText: { fontSize: 14, color: theme.color.ink },
});
