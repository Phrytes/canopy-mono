/**
 * requestMeshPermissions — request all runtime permissions a mesh agent
 * needs before its native transports are initialised.
 *
 *   BLE on Android 12+ : BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT
 *   BLE on Android ≤11 : ACCESS_FINE_LOCATION (BLE scanning requires it)
 *   mDNS on any Android: ACCESS_FINE_LOCATION (Zeroconf also requires it)
 *
 * Returns `{ ble, location }` booleans so callers can decide whether to
 * skip a transport when a permission was denied.
 *
 * iOS: no runtime request here — Info.plist usage keys are the contract.
 *      We short-circuit to `{ ble: true, location: true }` so the caller
 *      can still attempt to start BLE; the OS will surface the permission
 *      prompt the first time the module actually scans/advertises.
 *
 * See EXTRACTION-PLAN.md §7 Group O.
 */
import { PermissionsAndroid, Platform } from 'react-native';

export async function requestMeshPermissions() {
  if (Platform.OS !== 'android') {
    return { ble: true, location: true };
  }

  const result = { ble: false, location: false };

  try {
    // Location — required for both BLE scanning and mDNS on every Android version.
    const locResult = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title:          'Location permission',
        message:        'Needed to discover nearby agents via WiFi and Bluetooth.',
        buttonPositive: 'Allow',
      },
    );
    result.location = locResult === PermissionsAndroid.RESULTS.GRANTED;

    if (Platform.Version >= 31) {
      // Android 12+ — explicit BLE runtime permissions.
      const bleResults = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      result.ble = Object.values(bleResults).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED,
      );
    } else {
      // On Android ≤11, the location grant is sufficient for BLE.
      result.ble = result.location;
    }
  } catch (err) {
    // Defensive: don't let a permission-API hiccup crash the agent boot.
    // Caller will see ble:false / location:false and skip transports.
    // eslint-disable-next-line no-console
    console.warn('[requestMeshPermissions]', err?.message ?? err);
  }

  return result;
}
