/**
 * groupRegistry — Stoop's binding of the lifted bundle-registry helper.
 *
 * Lifted to `@canopy/react-native/storage` 2026-05-09 (Phase 41.0.b
 * A5). Tasks-mobile uses the same factory with
 * `{keyNamespace: 'tasks:crews', idField: 'circleId'}` in Phase 41.7.
 */

import { createBundleRegistry } from '@canopy/react-native/storage';

function _registry(storage) {
  return createBundleRegistry({
    keyNamespace: 'stoop:groups',
    idField:      'groupId',
    storage,
  });
}

export async function listGroups({ storage } = {}) {
  return _registry(storage).list();
}
export async function addGroup({ entry, storage } = {}) {
  return _registry(storage).add(entry);
}
export async function removeGroup({ groupId, storage } = {}) {
  return _registry(storage).remove(groupId);
}
export async function getActiveGroupId({ storage } = {}) {
  return _registry(storage).getActiveId();
}
export async function setActiveGroupId({ groupId, storage } = {}) {
  return _registry(storage).setActiveId(groupId);
}

// Back-compat: expose the original `KEY_LIST` / `KEY_ACTIVE` shape
// (UPPERCASE, the names this module always exported) alongside the
// substrate's lowercase fields.
const _ri = _registry()._internal;
export const _internal = {
  ..._ri,
  KEY_LIST:   _ri.keyList,
  KEY_ACTIVE: _ri.keyActive,
};
