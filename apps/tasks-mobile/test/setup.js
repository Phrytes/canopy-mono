/**
 * test/setup.js — Vitest global setup for tasks-mobile.
 *
 * vitest runs in node, not a real RN runtime, so we stub the Expo
 * modules our screens + lib code import. Mirrors the
 * apps/stoop-mobile/test/setup.js shape; per-test files overload via
 * vi.mock() when they need richer mocks.
 *
 * No test file should reach for a real device / real network.
 */

import { vi } from 'vitest';

// React Native — only the surfaces our pure-JS lib code touches in node.
vi.mock('react-native', () => {
  const Platform = { OS: 'android', select: (obj) => obj.android ?? obj.default };
  return {
    Platform,
    StyleSheet: { create: (s) => s, hairlineWidth: 1, flatten: (s) => s },
    Alert:       { alert: vi.fn() },
    Linking: {
      openURL:          vi.fn(),
      getInitialURL:    vi.fn(async () => null),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    AppState: {
      currentState: 'active',
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    // Component stubs — the tests mostly poke at logic, not rendered output.
    View:                 'View',
    Text:                 'Text',
    Pressable:            'Pressable',
    TextInput:            'TextInput',
    ScrollView:           'ScrollView',
    FlatList:             'FlatList',
    SafeAreaView:         'SafeAreaView',
    StatusBar:            'StatusBar',
    ActivityIndicator:    'ActivityIndicator',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
  };
});

// React Navigation — used by App.js's NavigationContainer.
vi.mock('@react-navigation/native', () => ({
  useNavigation: vi.fn(() => ({ navigate: vi.fn(), goBack: vi.fn(), setOptions: vi.fn() })),
  useRoute:      vi.fn(() => ({ params: {} })),
  NavigationContainer: ({ children }) => children,
}));

vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen:    ({ children }) => children,
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// AsyncStorage — module loads natively in RN; under vitest we stub
// with an in-memory Map. Mirrors apps/stoop-mobile/test/setup.js.
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  const api = {
    getItem:    vi.fn(async (k) => store.get(k) ?? null),
    setItem:    vi.fn(async (k, v) => { store.set(k, v); }),
    removeItem: vi.fn(async (k) => { store.delete(k); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys) => { for (const k of keys) store.delete(k); }),
    clear:       vi.fn(async () => { store.clear(); }),
  };
  return { default: api, ...api };
});

// Avoid pulling AsyncStorageAdapter's full native plumbing through
// the substrate — buildMeshAgent uses it via a stable interface, the
// no-op stub is enough for vitest.
vi.mock('@onderling/react-native/src/storage/AsyncStorageAdapter.js', () => ({
  AsyncStorageAdapter: class {
    constructor() {}
    async get()    { return null; }
    async set()    { /* swallow */ }
    async delete() { /* swallow */ }
    async list()   { return []; }
  },
}));

// FileSystemAdapter pulls expo-file-system at module load; vitest
// stub keeps the substrate import graph parseable.
vi.mock('@onderling/react-native/src/storage/FileSystemAdapter.js', () => ({
  FileSystemAdapter: class {
    constructor() {}
    async read()   { return null; }
    async write()  { /* swallow */ }
    async delete() { /* swallow */ }
    async list()   { return []; }
  },
}));

// expo-camera ships TS sources vite's pre-bundle can't parse; stub
// the surface OnboardScanScreen uses.
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true }, vi.fn(async () => ({ granted: true }))],
}));

// react-native-qrcode-svg pulls in TS too; stub.
vi.mock('react-native-qrcode-svg', () => ({
  default: 'QRCode',
}));

// react-native-keychain ships TS — vite's pre-resolve hits it via
// the substrate's KeychainVault dynamic-import path even when the
// runtime never reaches there. Mock with a no-op shape.
vi.mock('react-native-keychain', () => ({
  setGenericPassword: vi.fn(async () => ({ service: 'tasks' })),
  getGenericPassword: vi.fn(async () => false),
  resetGenericPassword: vi.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED: 'WHEN_UNLOCKED' },
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET' },
  default: {},
}));
