/**
 * DeliverablePhoto — inline thumbnail + tap-to-zoom modal for a
 * task's `deliverable.ref` (set by SubmitScreen on photo DoD).
 *
 * Phase 41.6.2 (2026-05-09).
 *
 * Reads the photo bytes via the active crew's `dataSource.read(ref)`
 * — SubmitScreen writes the data-URL form (Phase 41.5), so the
 * Image src consumes the value verbatim.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, Modal } from 'react-native';
import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';

/**
 * @param {object} props
 * @param {object} props.deliverable    `{kind, ref, thumbnail?, ...}`
 * @param {number} [props.thumbSize=96]
 */
export function DeliverablePhoto({ deliverable, thumbSize = 96 }) {
  const { COLORS, SPACING, RADII } = useTheme();
  const svc = useService();
  const [zoom, setZoom] = useState(false);
  const [full, setFull] = useState(null);

  const isPhoto = deliverable?.kind === 'photo' && typeof deliverable?.ref === 'string';

  useEffect(() => {
    if (!isPhoto || !zoom) return;
    let cancelled = false;
    (async () => {
      const cs = svc?.crews?.get(svc?.activeCrewId);
      if (!cs?.dataSource?.read) return;
      try {
        const v = await cs.dataSource.read(deliverable.ref);
        if (!cancelled && typeof v === 'string') setFull(v);
      } catch { /* swallow — modal renders just the thumbnail */ }
    })();
    return () => { cancelled = true; };
  }, [isPhoto, zoom, svc, deliverable?.ref]);

  if (!isPhoto) return null;

  return (
    <View>
      <Pressable
        onPress={() => setZoom(true)}
        accessibilityRole="image"
        accessibilityLabel="deliverable-photo-thumb"
      >
        <Image
          source={{ uri: deliverable.thumbnail ?? deliverable.ref }}
          style={{
            width:  thumbSize,
            height: thumbSize,
            borderRadius: RADII.sm,
            backgroundColor: COLORS.surfaceMuted,
          }}
        />
      </Pressable>

      <Modal
        transparent
        visible={zoom}
        animationType="fade"
        onRequestClose={() => { setZoom(false); setFull(null); }}
      >
        <Pressable
          onPress={() => { setZoom(false); setFull(null); }}
          accessibilityRole="button"
          accessibilityLabel="deliverable-photo-zoom-close"
          style={{
            flex: 1, backgroundColor: COLORS.overlay,
            alignItems: 'center', justifyContent: 'center',
            padding: SPACING.lg,
          }}
        >
          {full ? (
            <Image
              source={{ uri: full }}
              accessibilityLabel="deliverable-photo-zoom"
              resizeMode="contain"
              style={{ width: '100%', height: '80%' }}
            />
          ) : (
            <Text style={{ color: COLORS.textInverse }}>…</Text>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}
