/**
 * canopy-chat-mobile v2 — screen renderer (α.1e.1).
 *
 * RN counterpart of web's circleScreen.js — consumes the same
 * materialized blocks (`materializeRecipe(...)`) and renders the
 * scherm-mode page.
 *
 * Per-type render:
 *   announcement → serif headline card
 *   text         → paragraph card
 *   photo        → image with optional caption
 *   noticeboard  → list of recent posts (sender · text)
 *   agenda       → list of upcoming events (label)
 *   rules        → per-field rendered governance doc
 *
 * Per-block status:
 *   ok    → normal render
 *   empty → muted per-block fallback ("nothing to show here yet")
 *   error → red border + error message; one bad block doesn't break
 *           the rest of the page.
 *
 * Empty `blocks` array → top-level empty state ("admin hasn't set up
 * a screen yet").
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { t } from '../../core/localisation.js';

export default function CircleScreenView({ blocks = null }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <View testID="circle-screen-empty">
        <Text style={styles.empty}>{t('circle.screen.empty')}</Text>
      </View>
    );
  }
  return (
    <View testID="circle-screen">
      {blocks.map((block) => (
        <BlockSection key={block.blockId} block={block} />
      ))}
    </View>
  );
}

function BlockSection({ block }) {
  const baseStyle = [styles.block, styles[`block_${block.type}`] ?? null];

  if (block.status === 'error') {
    return (
      <View style={[...baseStyle, styles.blockError]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockErrorText}>
          {t('circle.screen.block_error', { type: block.type })}{block.error ? ` — ${block.error}` : ''}
        </Text>
      </View>
    );
  }
  if (block.status === 'empty') {
    return (
      <View style={[...baseStyle, styles.blockEmpty]} testID={`screen-block-${block.blockId}`}>
        <Text style={styles.blockEmptyText}>{t('circle.screen.block_empty', { type: block.type })}</Text>
      </View>
    );
  }

  let body = null;
  switch (block.type) {
    case 'announcement': body = renderAnnouncement(block); break;
    case 'text':         body = renderText(block); break;
    case 'photo':        body = renderPhoto(block); break;
    case 'noticeboard':  body = renderNoticeboard(block); break;
    case 'agenda':       body = renderAgenda(block); break;
    case 'rules':        body = renderRules(block); break;
    default:
      body = <Text style={styles.blockEmptyText}>{t('circle.screen.block_unknown', { type: block.type })}</Text>;
  }
  return <View style={baseStyle} testID={`screen-block-${block.blockId}`}>{body}</View>;
}

/* ─────────────────────────────────────────────────────────────────────── */

function renderAnnouncement(block) {
  return <Text style={styles.announcement}>{block.content?.text ?? ''}</Text>;
}

function renderText(block) {
  return <Text style={styles.text}>{block.content?.text ?? ''}</Text>;
}

function renderPhoto(block) {
  const src = block.content?.src ?? '';
  const caption = (block.content?.caption ?? '').trim();
  return (
    <View>
      <Image
        source={{ uri: src }}
        accessibilityLabel={caption}
        style={styles.photo}
        resizeMode="cover"
      />
      {caption ? <Text style={styles.photoCaption}>{caption}</Text> : null}
    </View>
  );
}

function renderNoticeboard(block) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.noticeboard')}</Text>
      {items.map((row) => {
        const sender = pickSender(row);
        const text   = pickRowText(row);
        return (
          <View key={row.id ?? Math.random().toString(36)} style={styles.noticeRow}>
            {sender ? <Text style={styles.noticeSender}>{sender}</Text> : null}
            <Text style={styles.noticeText}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

function renderAgenda(block) {
  const items = block.content?.items ?? [];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.agenda')}</Text>
      {items.map((ev) => (
        <View key={ev.id ?? Math.random().toString(36)} style={styles.agendaRow}>
          <Text style={styles.agendaLabel}>{ev.label ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}

function renderRules(block) {
  const doc = block.content?.doc ?? {};
  const fields = ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility'];
  return (
    <View>
      <Text style={styles.blockTitle}>{t('circle.recipe.block.rules')}</Text>
      {fields.map((f) => {
        const value = (doc[f] ?? '').trim();
        if (!value) return null;
        return (
          <View key={f} style={styles.rulesField}>
            <Text style={styles.rulesLabel}>{t(`circle.rules.field.${f}`)}</Text>
            <Text style={styles.rulesValue}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function pickSender(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['senderDisplay', 'authorName', 'displayName', 'actor']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  if (typeof row?.actor === 'string' && row.actor) return row.actor;
  return null;
}

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return '';
}

const styles = StyleSheet.create({
  empty:           { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  block:           { padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card },
  blockEmpty:      { backgroundColor: theme.color.paper2, borderColor: theme.color.line },
  blockEmptyText:  { color: theme.color.inkSoft, fontStyle: 'italic', fontSize: 13 },
  blockError:      { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  blockErrorText:  { color: theme.color.accentInk, fontSize: 13 },
  blockTitle:     { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 8 },

  announcement:    { fontFamily: theme.font.serif, fontSize: 18, color: theme.color.ink, lineHeight: 24 },
  text:            { fontSize: 14, color: theme.color.ink, lineHeight: 20 },

  photo:           { width: '100%', aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: theme.color.paper2 },
  photoCaption:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 6 },

  noticeRow:       { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  noticeSender:    { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  noticeText:      { fontSize: 14, color: theme.color.ink },

  agendaRow:       { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  agendaLabel:     { fontSize: 14, color: theme.color.ink },

  rulesField:      { marginBottom: 10 },
  rulesLabel:      { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  rulesValue:      { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
});
