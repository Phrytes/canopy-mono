/**
 * OfferingMatchInboxScreen — incoming auto-skill-match suggestions.
 *
 * Stoop V3 Phase 40.20 (2026-05-08).
 *
 * Subscribes to `agent.on('offering-match-suggestion', ...)` events that
 * the Stoop bundle (Agent.js) emits via the OfferingMatch substrate's
 * appHandler bridge.  Each event carries `{request, decide}`.  The
 * receive-side privacy gate (Phase 22 `notifyWorthy` filter) already
 * ran inside the substrate; what reaches this screen is "this matches
 * your local skill profile, do you want to help?"
 *
 * Each row:
 *   - Requester handle (resolved via MemberMap, anonymised
 *     ("@onbekend") if not in the local roster — common for
 *     extra-audience hops).
 *   - Source-scope chip: group / contact / hop.
 *   - Skill / category snapshot.
 *   - "Help" / "Negeer" CTAs that call `decide('claim'|'decline')`.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import {
  classifyOrigin, appendSuggestion, dedupSuggestions,
} from '../lib/offeringMatchListener.js';
import { useService }                         from '../ServiceContext.js';

export function OfferingMatchInboxScreen() {
  const svc = useService();
  const [list, setList] = useState([]);

  // Subscribe to the live event from the Stoop bundle.  The bundle
  // emits `'offering-match-suggestion'` whenever a skill-match request
  // (group OR extra-audience) reaches the appHandler.
  useEffect(() => {
    const agent = svc?.activeBundle?.agent;
    if (!agent || typeof agent.on !== 'function') return undefined;
    const handler = (event) => {
      if (!event || !event.request) return;
      setList((prev) => dedupSuggestions(appendSuggestion(prev, {
        ...event,
        receivedAt: Date.now(),
        status: 'pending',
      })));
    };
    agent.on('offering-match-suggestion', handler);
    return () => {
      try {
        if (typeof agent.off === 'function') agent.off('offering-match-suggestion', handler);
        else if (typeof agent.removeListener === 'function') {
          agent.removeListener('offering-match-suggestion', handler);
        }
      } catch { /* swallow */ }
    };
  }, [svc?.activeBundle]);

  const respond = useCallback(async (idx, decision) => {
    const entry = list[idx];
    if (!entry || entry.status !== 'pending') return;
    try {
      await entry.decide?.(decision);
      setList((prev) => prev.map((e, i) => i === idx ? { ...e, status: decision } : e));
    } catch (err) {
      setList((prev) => prev.map((e, i) => i === idx
        ? { ...e, status: 'error', error: err?.message ?? String(err) } : e));
    }
  }, [list]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('skillmatch.no_active_group',
             'Sluit eerst aan bij een groep om voorgestelde matches te zien.')}
        </Text>
      </View>
    );
  }

  // Resolve handle from MemberMap — extra-audience peers (hop /
  // contact) often aren't in the closed-group roster, so the lookup
  // fails and we fall back to anonymous.
  const members = svc.activeBundle.members;
  const lookupHandle = (from) => {
    try {
      const m = members?.resolveByPubKey?.(from)
             ?? members?.resolveByWebid?.(from)
             ?? members?.resolveByStableId?.(from);
      return m?.handle ?? null;
    } catch { return null; }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>
        {t('skillmatch.heading', 'Voorgestelde matches')}
      </Text>
      <Text style={styles.body}>
        {t('skillmatch.intro',
           'Anderen vragen om hulp die past bij jouw skills. Tik "Help" om te claimen.')}
      </Text>

      <FlatList
        data={list}
        keyExtractor={(e, i) => `${e.request?.requestId ?? i}`}
        renderItem={({ item, index }) => {
          const origin = classifyOrigin(item.request);
          const handle = lookupHandle(item.request?.from);
          const skills = Array.isArray(item.request?.requiredSkills)
            ? item.request.requiredSkills.join(', ') : '';
          const text   = item.request?.payload?.text ?? '';
          return (
            <View style={styles.row}>
              <View style={[styles.originChip, _chipStyle(origin)]}>
                <Text style={styles.originChipText}>{_originLabel(origin)}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.handle}>{handle ? `@${handle}` : t('skillmatch.anon', '@onbekend')}</Text>
                {skills ? <Text style={styles.skills}>{skills}</Text> : null}
                {text ? <Text style={styles.body} numberOfLines={2}>{text}</Text> : null}
                {item.error ? <Text style={styles.errorText}>{item.error}</Text> : null}
              </View>
              {item.status === 'pending' ? (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => respond(index, 'claim')}
                    style={styles.btnPrimary}
                    accessibilityRole="button"
                    accessibilityLabel={`skillmatch-help-${index}`}
                  >
                    <Text style={styles.btnPrimaryLabel}>{t('skillmatch.help', 'Help')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond(index, 'decline')}
                    style={styles.btnGhost}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnGhostLabel}>{t('skillmatch.ignore', 'Negeer')}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.statusTag}>
                  {item.status === 'claim' ? t('skillmatch.claimed', 'geholpen ✓')
                   : item.status === 'decline' ? t('skillmatch.declined', 'genegeerd')
                   : item.status === 'error' ? t('skillmatch.errored', 'mislukt')
                   : ''}
                </Text>
              )}
            </View>
          );
        }}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {t('skillmatch.empty', 'Geen openstaande voorstellen.')}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function _originLabel(origin) {
  switch (origin) {
    case 'group':   return t('skillmatch.origin_group',   'groep');
    case 'contact': return t('skillmatch.origin_contact', 'contact');
    case 'hop':     return t('skillmatch.origin_hop',     'hop');
    default:        return '?';
  }
}

function _chipStyle(origin) {
  switch (origin) {
    case 'group':   return { backgroundColor: COLORS.primaryLight };
    case 'contact': return { backgroundColor: '#e3f2fd' };
    case 'hop':     return { backgroundColor: '#fff3e0' };
    default:        return { backgroundColor: COLORS.surfaceMuted };
  }
}

export default OfferingMatchInboxScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  body: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, lineHeight: 20, marginBottom: SPACING.md },
  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: SPACING.md, marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  originChip: {
    paddingHorizontal: SPACING.sm, paddingVertical: 2,
    borderRadius: RADII.pill, marginRight: SPACING.md,
    alignSelf: 'flex-start',
  },
  originChipText: { fontSize: FONT_SIZES.xs, color: COLORS.text, fontWeight: '600' },
  rowText: { flex: 1, marginRight: SPACING.md },
  handle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  skills: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.xs },
  actions: { alignItems: 'flex-end' },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADII.sm, marginBottom: 4,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  btnGhost: { paddingVertical: 2, paddingHorizontal: SPACING.sm },
  btnGhostLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  statusTag: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontStyle: 'italic' },
  empty: { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted, textAlign: 'center' },
});
