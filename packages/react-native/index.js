export { KeychainVault }          from './src/identity/KeychainVault.js';
export { attachIdentityToAgent }  from './src/identity/IdentityWiring.js';
export { AsyncStorageAdapter }    from './src/storage/AsyncStorageAdapter.js';
export { MdnsTransport }          from './src/transport/MdnsTransport.js';
export { BleTransport, SERVICE_UUID, CHARACTERISTIC_UUID }
                                  from './src/transport/BleTransport.js';
export { requestMeshPermissions } from './src/permissions.js';
export { createMeshAgent }        from './src/createMeshAgent.js';
export { MobilePushBridge }       from './src/transport/MobilePushBridge.js';
export { PushAdapter }            from './src/transport/pushAdapters/PushAdapter.js';
// ExpoNotificationsAdapter is intentionally NOT re-exported from the barrel —
// it imports `expo-notifications` at module-load time (peer dep), and apps
// that don't use push shouldn't be forced to install it.  Use the subpath:
//   import { ExpoNotificationsAdapter }
//     from '@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js';
