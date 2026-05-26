// Detox configuration for canopy-chat-mobile (#254 — D-0 setup,
// 2026-05-26).  Targets the Android emulator (Medium_Phone_API_36)
// by default; the `attached` device can be selected via
// `--configuration android.attached.debug` for tests against a
// physical phone (Frits's c53828f5).
//
// Local-only — no CI yet.  See Project Files/canopy-chat/
// post-2026-05-24-priority.md → Bundle D for the rationale.

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0:     'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,        // long boot: realAgent + vault chain
    },
  },

  apps: {
    // Release build is the canonical Detox target.  Two reasons:
    //   1. Debug builds boot via expo-dev-launcher which waits for
    //      a manual tap on "use this Metro server" — Detox can't
    //      tap it because it has to launch via `am instrument` to
    //      get the WS bridge into the JS context, and `am instrument`
    //      doesn't go through the dev-launcher's intent picker.
    //   2. Release builds embed the JS bundle (assets/index.android.bundle)
    //      so Metro doesn't need to run during tests.
    'android.release': {
      type:           'android.apk',
      binaryPath:     'android/app/build/outputs/apk/release/app-release.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk',
      build:
        'cd android && ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release',
    },
  },

  devices: {
    emulator: {
      type:   'android.emulator',
      device: { avdName: 'Medium_Phone_API_36' },
    },
    attached: {
      type:   'android.attached',
      // Pin to Frits's specific phone (avoids picking the emulator
      // when both are connected).  Override with adbName: '.*' if a
      // different phone gets connected.
      device: { adbName: 'c53828f5' },
    },
  },

  configurations: {
    'android.emu.release': {
      device: 'emulator',
      app:    'android.release',
    },
    'android.attached.release': {
      device: 'attached',
      app:    'android.release',
    },
  },
};
