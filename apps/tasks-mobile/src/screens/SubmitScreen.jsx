/**
 * SubmitScreen — submit a claimed task for review.
 *
 * Phase 41.5.3 (2026-05-09).
 *
 * Branches on `definitionOfDone.kind`:
 *   - 'photo' → Take photo / Pick from library via the substrate's
 *     pickAndResize (Phase 41.0 L3 lift). Writes the resized JPEG
 *     bytes to `localStoreBundle.cache.write(deliverableRef, ...)`
 *     (path scheme from photoPresets.deliverableRef). Then calls
 *     `submitTask` with `deliverable: {kind: 'photo', ref: <path>,
 *     thumbnail: <data-url>}`.
 *   - 'text' (or unset) → free-text note input → submitTask with
 *     `deliverable: {kind: 'text', note}`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { pickAndResize } from '@canopy/react-native/picker';
import { useTheme }      from '@canopy/react-native/theme';

import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import {
  DELIVERABLE_PRESET, deliverableRef, photoId,
} from '../lib/photoPresets.js';

export function SubmitScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const taskId = route?.params?.id;

  // Look up the task via listOpen — same pattern as TaskDetailScreen.
  const list = useSkillResult('listOpen', {}, [svc?.activeCircleId, taskId]);
  const task = useMemo(() => {
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    return items.find((it) => it?.id === taskId) ?? null;
  }, [list?.data, taskId]);

  const dodKind = task?.definitionOfDone?.kind ?? 'text';
  const isPhoto = dodKind === 'photo';

  const submitSkill = useSkill('submitTask');

  const [photo, setPhoto] = useState(null); // {dataB64, thumbnail, width, height}
  const [note,  setNote]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  const pickPhoto = useCallback(async (mode) => {
    setError(null);
    try {
      const out = await pickAndResize({ mode, preset: DELIVERABLE_PRESET, max: 1 });
      if (out.length > 0) setPhoto(out[0]);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, []);

  const onSubmit = useCallback(async () => {
    if (!task) return;
    if (isPhoto && !photo) return;
    if (!isPhoto && !note.trim()) return;

    setBusy(true);
    setError(null);
    try {
      let deliverable;
      if (isPhoto) {
        const id  = photoId();
        const ref = deliverableRef({
          circleId: svc?.activeCircleId,
          taskId,
          photoId: id,
        });
        // Write the JPEG bytes (decoded from base64) into the cache so
        // approvers can fetch via `dataSource.read(ref)`.
        const cache = svc?.circles?.get(svc?.activeCircleId)?.dataSource;
        if (cache?.write) {
          // V1: store the data-URL form so the approver's UI can
          // render directly from the value. A future revision can
          // switch to raw bytes if that's preferred — `dataSource.read`
          // already returns the value verbatim.
          await cache.write(ref, `data:image/jpeg;base64,${photo.dataB64}`);
        }
        deliverable = {
          kind:      'photo',
          ref,
          thumbnail: photo.thumbnail,
          width:     photo.width,
          height:    photo.height,
          bytes:     photo.bytes,
          note:      note.trim() || undefined,
        };
      } else {
        deliverable = { kind: 'text', note: note.trim() };
      }

      const r = await submitSkill.call({ id: taskId, deliverable, note: note.trim() || undefined });
      if (r?.error) {
        setError(r.error);
        return;
      }
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [task, isPhoto, photo, note, svc, taskId, submitSkill, nav]);

  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
          {list?.loading ? '…' : t('mobile.task_detail.no_open_tasks')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, backgroundColor: COLORS.background, padding: SPACING.xl,
      }}
    >
      <Text style={{
        fontSize: FONT_SIZES.xl, fontWeight: '600',
        color: COLORS.text, marginBottom: SPACING.sm,
      }}>
        {isPhoto ? t('mobile.deliverable_photo.title') : t('mobile.deliverable_photo.title_text')}
      </Text>

      <Text
        numberOfLines={2}
        style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted, marginBottom: SPACING.lg }}
      >
        {task.text}
      </Text>

      {isPhoto ? (
        <View style={{ marginBottom: SPACING.lg }}>
          {photo ? (
            <View>
              <Image
                source={{ uri: photo.thumbnail }}
                accessibilityLabel="deliverable-photo-preview"
                style={{
                  width:  '100%', aspectRatio: 1,
                  borderRadius: RADII.md,
                  backgroundColor: COLORS.surfaceMuted,
                  marginBottom: SPACING.sm,
                }}
              />
              <Pressable
                onPress={() => setPhoto(null)}
                accessibilityRole="button"
                style={{
                  alignSelf: 'flex-start',
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                  borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                  {t('mobile.deliverable_photo.retake')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
              <Pressable
                onPress={() => pickPhoto('camera')}
                accessibilityRole="button"
                accessibilityLabel="submit-take-photo"
                style={{
                  paddingVertical: SPACING.lg, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.md, backgroundColor: COLORS.primary,
                }}
              >
                <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
                  {t('mobile.deliverable_photo.take_photo')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => pickPhoto('library')}
                accessibilityRole="button"
                accessibilityLabel="submit-pick-library"
                style={{
                  paddingVertical: SPACING.lg, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' }}>
                  {t('mobile.deliverable_photo.pick_library')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, marginBottom: SPACING.sm }}>
        {t('mobile.deliverable_photo.note_label')}
      </Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        autoCapitalize="sentences"
        accessibilityLabel="submit-note"
        style={{
          minHeight: 100,
          borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
          padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
          backgroundColor: COLORS.surface, textAlignVertical: 'top',
          marginBottom: SPACING.md,
        }}
      />

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {t('mobile.deliverable_photo.submit_failed', null).replace('{reason}', error)}
        </Text>
      ) : null}

      <Pressable
        onPress={onSubmit}
        disabled={busy || (isPhoto && !photo) || (!isPhoto && !note.trim())}
        accessibilityRole="button"
        accessibilityLabel="submit-confirm"
        style={({ pressed }) => {
          const ok = !busy && (isPhoto ? !!photo : !!note.trim());
          return [
            {
              paddingVertical: SPACING.lg, borderRadius: RADII.md,
              alignItems: 'center',
              backgroundColor: ok ? COLORS.primary : COLORS.surfaceMuted,
            },
            pressed && ok && { opacity: 0.85 },
          ];
        }}
      >
        <Text style={{
          color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600',
        }}>
          {busy ? t('mobile.deliverable_photo.submitting') : t('mobile.deliverable_photo.submit')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
