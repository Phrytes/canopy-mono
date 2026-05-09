/**
 * PermissionRationale — modal explaining why a permission is needed
 * before the OS prompt. Localised copy, consumer wires the actual
 * permission request callback.
 *
 * Phase 41.3.5 (2026-05-09).
 *
 * Reuses the substrate's <ConfirmModal> shape; tasks-mobile passes
 * the rationale-specific copy via the `body` prop.
 */

import React from 'react';
import { ConfirmModal } from '@canopy/react-native/components';
import { useI18n } from '../I18nProvider.js';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {'camera' | 'notifications' | 'calendar' | 'location'} props.kind
 * @param {() => void} props.onGrant   user accepted — request OS permission
 * @param {() => void} [props.onSkip]  user declined; default closes the modal
 */
export function PermissionRationale({ visible, kind, onGrant, onSkip }) {
  const { t } = useI18n();
  return (
    <ConfirmModal
      visible={visible}
      title={t('mobile.permissions.title')}
      body={t(`mobile.permissions.${kind}`)}
      confirmLabel={t('mobile.permissions.grant')}
      cancelLabel={t('mobile.permissions.skip')}
      onConfirm={onGrant}
      onCancel={onSkip ?? (() => {})}
    />
  );
}
