// Stub for expo-camera (TypeScript-shipped on the real device).
// Vite's import-graph analysis resolves expo-camera before the test
// file's vi.mock() runs, so we need a parseable JS shim.

export const CameraView = 'CameraView';

export function useCameraPermissions() {
  return [{ granted: true, status: 'granted' }, async () => ({ granted: true })];
}

export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied' };
