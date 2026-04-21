/**
 * Request all Android runtime permissions needed by the app before any
 * native transport is initialised.
 *
 * BLE (Android 12+): BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT
 * BLE (Android ≤11): ACCESS_FINE_LOCATION  (BLE scanning needs it)
 * mDNS: ACCESS_FINE_LOCATION               (Zeroconf also needs it)
 *
 * Returns a plain object { ble: bool, location: bool } so callers can decide
 * which transports to skip if a permission was denied.
 */
import { PermissionsAndroid, Platform } from 'react-native';

export async function requestPermissions() {
  if (Platform.OS !== 'android') return { ble: true, location: true };

  const results = { ble: false, location: false };

  try {
    // Location — needed for both BLE scanning and mDNS on all Android versions
    const loc = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title:   'Location permission',
        message: 'Needed to discover nearby agents via WiFi and Bluetooth.',
        buttonPositive: 'Allow',
      },
    );
    results.location = loc === PermissionsAndroid.RESULTS.GRANTED;

    // Android 12+ needs explicit BLE permissions
    if (Platform.Version >= 31) {
      const blePerms = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      results.ble = Object.values(blePerms).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED,
      );
    } else {
      // On Android ≤11 the location permission is enough for BLE
      results.ble = results.location;
    }
  } catch (err) {
    console.warn('Permission request failed:', err);
  }

  return results;
}
