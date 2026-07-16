/**
 * test/setup.js — Vitest global setup for stoop-mobile.
 *
 * vitest runs in node, not a real RN runtime, so we stub the Expo
 * modules our screens / auth / context import.  Each test that
 * wants behavioural coverage replaces the stub with a richer mock
 * via vi.mock().
 *
 * No test file should reach for a real device / real network.
 *
 * Mirrors apps/folio-mobile/test/setup.js, with stoop:// scheme +
 * stoop-flavoured defaults.
 */

import { vi } from 'vitest';

// React Native — only the surfaces our pure-JS lib code touches in node:
// mostly module imports we never invoke under test.  We stub the parts
// that DO get imported so tests can exercise our adapter / lib code
// without pulling in the RN runtime.
vi.mock('react-native', () => {
  const Platform = { OS: 'ios', select: (obj) => obj.ios ?? obj.default };
  return {
    Platform,
    StyleSheet: { create: (s) => s, hairlineWidth: 1, flatten: (s) => s },
    Alert:       { alert: vi.fn() },
    Linking: {
      openURL:          vi.fn(),
      getInitialURL:    vi.fn(async () => null),
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

// Expo modules — minimal stubs.  Tests overload these per-suite.
vi.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync:    vi.fn(async (k) => store.get(k) ?? null),
    setItemAsync:    vi.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: vi.fn(async (k) => { store.delete(k); }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __resetForTest: () => store.clear(),
  };
});

vi.mock('expo-auth-session', () => ({
  // useAuthRequest returns [request, response, promptAsync].
  useAuthRequest:   vi.fn(() => [null, null, vi.fn()]),
  exchangeCodeAsync: vi.fn(async () => ({
    accessToken:  'mock-access',
    refreshToken: 'mock-refresh',
    idToken:      'mock-id',
    expiresIn:    3600,
  })),
  AuthRequest:     class { async promptAsync() { return { type: 'success', params: { code: 'mock-code' } }; } },
  ResponseType:    { Code: 'code' },
  CodeChallengeMethod: { S256: 'S256' },
  makeRedirectUri: vi.fn(({ scheme = 'stoop', path = 'auth/callback' } = {}) => `${scheme}://${path}`),
  fetchDiscoveryAsync: vi.fn(async () => ({
    authorizationEndpoint: 'https://login.inrupt.com/authorize',
    tokenEndpoint:         'https://login.inrupt.com/token',
    revocationEndpoint:    'https://login.inrupt.com/revoke',
    discoveryDocument:     {},
  })),
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(async () => ({ type: 'success', url: 'stoop://auth/callback?code=mock-code' })),
  maybeCompleteAuthSession: vi.fn(),
  WebBrowserResultType: { SUCCESS: 'success', CANCEL: 'cancel', DISMISS: 'dismiss' },
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory:    'file:///cache/',
  EncodingType:      { UTF8: 'utf8', Base64: 'base64' },
  readAsStringAsync:  vi.fn(async () => ''),
  writeAsStringAsync: vi.fn(async () => {}),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  getInfoAsync:       vi.fn(async () => ({ exists: false })),
  deleteAsync:        vi.fn(async () => {}),
  moveAsync:          vi.fn(async () => {}),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding:        { HEX: 'hex', BASE64: 'base64' },
  digestStringAsync:     vi.fn(async () => '0'.repeat(64)),
}));

vi.mock('expo-task-manager', () => ({
  defineTask:   vi.fn(),
  isTaskDefined: vi.fn(() => false),
}));

vi.mock('expo-background-fetch', () => ({
  registerTaskAsync:   vi.fn(async () => {}),
  unregisterTaskAsync: vi.fn(async () => {}),
  getStatusAsync:      vi.fn(async () => 3),
  BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 },
}));

vi.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
}));

// Stoop-mobile specific Expo modules (V3 phases 40.5–40.9).
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: vi.fn(() => [{ granted: true }, vi.fn(async () => ({ granted: true }))]),
}));

vi.mock('expo-image-picker', () => ({
  launchCameraAsync: vi.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///mock.jpg', mimeType: 'image/jpeg', width: 100, height: 100 }],
  })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true, assets: [] })),
  requestCameraPermissionsAsync:           vi.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync:     vi.fn(async () => ({ granted: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async (uri) => ({ uri, width: 100, height: 100, base64: 'mock' })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  getCurrentPositionAsync: vi.fn(async () => ({
    coords: { latitude: 53.2, longitude: 6.6, accuracy: 10 },
  })),
  Accuracy: { Balanced: 4, High: 5 },
}));

vi.mock('expo-linking', () => ({
  createURL:        vi.fn((path, opts) => `stoop://${path}`),
  parse:            vi.fn((url) => ({ scheme: 'stoop', path: '', queryParams: {} })),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  getInitialURL:    vi.fn(async () => null),
  openURL:          vi.fn(async () => true),
}));

vi.mock('expo-notifications', () => ({
  getPermissionsAsync:     vi.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
  getExpoPushTokenAsync:   vi.fn(async () => ({ data: 'ExponentPushToken[mock]' })),
  setNotificationHandler:  vi.fn(),
  addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));

// React-navigation: our screens import `useNavigation()` etc.  Stub.
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
  SafeAreaView:     'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mesh transport stubs — agentBundle.js pulls these via the
// @onderling/react-native subpath so the vitest config alias can
// resolve to the real source files, but those files import
// `react-native` (Flow-typed) at module load.  Vitest's mock above
// short-circuits the import; we still need a placeholder for the
// classes so `MdnsTransport.isAvailable()` (called from
// buildMeshAgent) returns false in node and skips the mDNS branch.
vi.mock('@onderling/react-native/src/transport/MdnsTransport.js', () => ({
  MdnsTransport: class {
    static isAvailable() { return false; }
  },
}));

vi.mock('@onderling/react-native/src/storage/AsyncStorageAdapter.js', () => ({
  // Minimal stub — buildMeshAgent passes one to PeerGraph.
  // PeerGraph's interaction with the backend is async and exercised
  // elsewhere; for the bundle-build test we just need a no-op.
  AsyncStorageAdapter: class {
    constructor() {}
    async get()    { return null; }
    async set()    { /* swallow */ }
    async delete() { /* swallow */ }
    async list()   { return []; }
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    default: {
      getItem:   vi.fn(async (k) => store.get(k) ?? null),
      setItem:   vi.fn(async (k, v) => { store.set(k, v); }),
      removeItem: vi.fn(async (k) => { store.delete(k); }),
      getAllKeys: vi.fn(async () => [...store.keys()]),
      multiRemove: vi.fn(async (keys) => { for (const k of keys) store.delete(k); }),
      clear:      vi.fn(async () => { store.clear(); }),
    },
  };
});
