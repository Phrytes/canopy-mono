/**
 * Persistent app settings backed by AsyncStorage.
 * Currently only stores the relay URL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'mesh-demo:settings';

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
}
