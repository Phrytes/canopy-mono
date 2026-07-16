// canopy-chat-mobile metro.config.js — mirrors stoop-mobile + folio-mobile.
//
// The @canopy/react-native metro-preset handles:
//   - NODE_BUILTINS shimming + `node:` prefix stripping
//   - util / path / ws shim routing
//   - `@canopy/react-native/platform/*` subpath resolution (Metro 52
//     disables unstable_enablePackageExports, so the package's
//     `exports` map for ./platform/polyfills etc. must be hand-resolved)
//   - generic @canopy/<pkg>/<subpath> resolver from each package's exports map
//
// canopy-chat-mobile's app-specific bits are:
//   - 5 sibling apps in watchFolders (canopy-chat + the 4 composed apps)
//   - extraNodeModules aliases for the workspace packages that are NOT
//     declared in package.json deps (e.g. @canopy/vault, pulled in
//     transitively by realAgent.js → secure-agent)
//   - extraSubpathResolvers for `@canopy-app/{tasks-v0,stoop,folio}/browser`
//     (Trap 2 — overlapping `extraNodeModules` prefixes; shorter prefix
//     wins, so Metro would otherwise try apps/<app>/browser instead of
//     apps/<app>/src/browser.js)
//   - The same stoop /lib + /locales resolvers stoop-mobile uses, since
//     the realAgent.js chain transitively reaches stoop's app-internal
//     subpaths.

const path = require('path');
const { withCanopyPreset } = require('@canopy/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

const _cfg = withCanopyPreset({
  projectRoot,
  repoRoot,

  // Composition shell — realAgent.js imports the browser factories of
  // tasks-v0 / stoop / folio + the calendar app barrel + canopy-chat's
  // own core/web sources via relative paths.  Each app's source dir
  // needs to be in the Metro watch graph.
  watchFolders: [
    path.resolve(repoRoot, 'apps/canopy-chat'),
    path.resolve(repoRoot, 'apps/tasks-v0'),
    path.resolve(repoRoot, 'apps/stoop'),
    path.resolve(repoRoot, 'apps/folio'),
    path.resolve(repoRoot, 'apps/calendar'),
    // M6 — the feedback bot: canopy-chat's feedbackSurface/feedbackMount consume the
    // SPLIT onderling-feedback repo ('onderling-feedback/public', a link: dep) — watch
    // the sibling checkout so Metro resolves + hot-reloads across the repo boundary.
    path.resolve(repoRoot, '../feedback'),
    // Workspace packages the composed apps + secure-agent reach for.
    path.resolve(repoRoot, 'packages/vault'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/skill-match'),
    path.resolve(repoRoot, 'packages/manifest-host'),
    path.resolve(repoRoot, 'packages/app-manifest'),
    // @canopy/llm-client — the circle bot's NL→slash LLM client (ollama provider).
    path.resolve(repoRoot, 'packages/llm-client'),
  ],

  // Block apps/<app>/node_modules — server / CLI / web-only deps the
  // mobile bundle never reaches.
  //
  // Plus a NARROW block on RN / Expo entries in any packages/*/.pnpm
  // store — needed because canopy-chat-mobile's `file:` dep on
  // @canopy/react-native triggers an npm install pass inside that
  // package, which in turn lets pnpm hoist RN 0.85.3 into
  // packages/react-native/node_modules/.pnpm/.  Metro then follows
  // symlinks into that store and tries to compile RN 0.85.3 with our
  // RN 0.76 babel preset, exploding on the `match` TC39 syntax.
  // Blocking only the RN/Expo entries leaves legitimate symlinks (e.g.
  // @inrupt/solid-client in packages/core/node_modules/.pnpm) intact.
  extraBlockListRegExps: [
    new RegExp(
      `^(${['canopy-chat', 'tasks-v0', 'stoop', 'folio', 'calendar']
        .map((a) => path.resolve(repoRoot, `apps/${a}/node_modules`).replace(/[/\\]/g, '[/\\\\]'))
        .join('|')}).*`,
    ),
    new RegExp(
      `^${path.resolve(repoRoot, 'packages').replace(/[/\\]/g, '[/\\\\]')}[/\\\\][^/\\\\]+[/\\\\]node_modules[/\\\\]\\.pnpm[/\\\\](react-native|@react-native|expo|@expo|hermes)[^/\\\\]*[/\\\\].*`,
    ),
  ],

  // Pin React / RN / native modules to this app's node_modules so the
  // monorepo can't pull in conflicting versions.  Mirrors stoop-mobile.
  pinToAppModules: [
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-get-random-values',
    'react-native-safe-area-context',
    'react-native-screens',
    // expo-crypto: the app + the installed dev-client APK ship 14.0.2 (Expo SDK 52,
    // no native AES). packages/sync-engine carries a STRAY 56.0.3 whose module-load
    // requires a native `ExpoCryptoAES` the APK doesn't have → "Cannot find native
    // module 'ExpoCryptoAES'" runtime crash. sync-engine only needs digestStringAsync
    // (hashing), present in both, so pinning all expo-crypto to the app's 14.0.2 is safe.
    'expo-crypto',
  ],

  // App-specific module aliases (the preset already maps the @canopy/*
  // SDK packages declared in this app's package.json).  These are the
  // packages pulled in TRANSITIVELY by the composed apps that aren't
  // direct deps of canopy-chat-mobile.
  extraNodeModules: {
    // Direct: the 5 composed apps.  realAgent.js uses subpath imports
    // (/browser) — those go through extraSubpathResolvers below.
    '@canopy-app/canopy-chat': path.resolve(repoRoot, 'apps/canopy-chat'),
    '@canopy-app/tasks-v0':    path.resolve(repoRoot, 'apps/tasks-v0'),
    '@canopy-app/stoop':       path.resolve(repoRoot, 'apps/stoop'),
    '@canopy-app/folio':       path.resolve(repoRoot, 'apps/folio'),
    '@canopy-app/calendar':    path.resolve(repoRoot, 'apps/calendar'),
    // realAgent.js's skill wiring (added 2026-07-09). Bare import → the `.` export (src/cores.js); the
    // /wireSkills + /defaultCatalog subpaths go through extraSubpathResolvers (package-exports disabled).
    '@canopy-app/agents':      path.resolve(repoRoot, 'apps/agents'),

    // Transitive @canopy/* not declared in package.json deps.
    // @canopy/vault is reached via secure-agent + realAgent.js's
    // VaultMemory / VaultLocalStorage imports (VaultAsyncStorage
    // replaces VaultLocalStorage at boot — but the import resolves
    // unconditionally, so the module must still exist on disk).
    '@canopy/vault':             path.resolve(repoRoot, 'packages/vault'),
    '@canopy/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@canopy/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@canopy/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@canopy/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@canopy/skill-match':       path.resolve(repoRoot, 'packages/skill-match'),
    '@canopy/manifest-host':     path.resolve(repoRoot, 'packages/manifest-host'),
    // @canopy/llm-client — bare import resolves via its package.json main (src/index.js); the
    // /providers/ollama subpath goes through extraSubpathResolvers (package-exports is disabled).
    '@canopy/llm-client':        path.resolve(repoRoot, 'packages/llm-client'),
    // Privacy-first logging facade (web ≡ mobile). Bare `.` export = src/index.js.
    '@canopy/logger':            path.resolve(repoRoot, 'packages/logger'),
  },

  // Subpath resolvers — Trap 2 escape hatch.
  //
  // `@canopy-app/{tasks-v0,stoop,folio}/browser` resolve to
  // `apps/<app>/src/browser.js` per each app's package.json `exports`
  // map; Metro can't see those because the preset disables
  // unstable_enablePackageExports.
  //
  // The stoop /lib + /locales resolvers mirror stoop-mobile's config —
  // the realAgent chain transitively reaches those subpaths.
  extraSubpathResolvers: [
    (moduleName /*, repoRootArg */) => {
      // 1. /browser subpath for the three composed app bundles.
      const browserMatch = moduleName.match(
        /^@canopy-app\/(tasks-v0|stoop|folio)\/browser$/,
      );
      if (browserMatch) {
        return {
          filePath: path.resolve(repoRoot, 'apps', browserMatch[1], 'src/browser.js'),
          type:     'sourceFile',
        };
      }

      // 2. Stoop's @canopy-app/stoop/lib/* — real files live in src/lib/.
      if (moduleName.startsWith('@canopy-app/stoop/lib/')) {
        const sub = moduleName.slice('@canopy-app/stoop/lib/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/src/lib', sub + '.js'),
          type:     'sourceFile',
        };
      }

      // 3. Stoop's locales — exports map points to apps/stoop/locales/{en,nl}.json.
      if (moduleName.startsWith('@canopy-app/stoop/locales/')) {
        const sub = moduleName.slice('@canopy-app/stoop/locales/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/stoop/locales', sub + '.json'),
          type:     'sourceFile',
        };
      }

      // 4. M6 — eld language detector (feedback pipeline's lang.js). Package `exports` subpaths
      //    (eld/medium etc.); Metro has package-exports disabled, so map to the static entry.
      const eldMatch = moduleName.match(/^eld\/(medium|small|large|extrasmall)$/);
      if (eldMatch) {
        return {
          filePath: path.resolve(repoRoot, 'apps/feedback-pipeline/node_modules/eld/src/entries', `static.${eldMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      // 4b. @canopy-app/agents subpaths (realAgent.js skill wiring). exports map: ./wireSkills →
      //     src/wireSkills.js, ./defaultCatalog → src/defaultCatalog.js, ./cores → src/cores.js,
      //     ./manifest → manifest.js. Package-exports disabled, so map directly.
      const agentsMatch = moduleName.match(/^@canopy-app\/agents\/(wireSkills|defaultCatalog|cores)$/);
      if (agentsMatch) {
        return { filePath: path.resolve(repoRoot, 'apps/agents/src', `${agentsMatch[1]}.js`), type: 'sourceFile' };
      }
      if (moduleName === '@canopy-app/agents/manifest') {
        return { filePath: path.resolve(repoRoot, 'apps/agents/manifest.js'), type: 'sourceFile' };
      }

      // 5. @canopy/llm-client provider subpaths (circle bot). Package-exports disabled → map directly.
      const llmMatch = moduleName.match(/^@canopy\/llm-client\/providers\/(ollama|mock)$/);
      if (llmMatch) {
        return {
          filePath: path.resolve(repoRoot, 'packages/llm-client/src/providers', `${llmMatch[1]}.js`),
          type:     'sourceFile',
        };
      }

      // 6. SHIM the Node-only Telegram bridge. It does `import { Telegraf } from 'telegraf'`
      //    + `class … extends Telegraf`; on Hermes telegraf doesn't load → the base is
      //    undefined → "Super expression must be null or a function" at module-eval → the
      //    whole agent boot fails. household/src re-exports it, so it lands in the RN bundle
      //    even though mobile never runs a Telegram bot. Resolve it to a no-op stub. (Mirror
      //    of the web vite alias.) Must be a subpath resolver, not extraShims — the preset's
      //    generic `@canopy/<pkg>/<subpath>` handler would otherwise resolve the real file first.
      if (moduleName === '@canopy/chat-agent/bridges/telegram') {
        return { filePath: path.resolve(__dirname, 'src/shims/telegramBridge.js'), type: 'sourceFile' };
      }

      return null;
    },
  ],
});

// Wrap the preset's resolveRequest to intercept BEFORE its generic `@canopy/<pkg>/<subpath>`
// handler. The Telegram bridge is Node-only (`import { Telegraf } from 'telegraf'` →
// `class … extends Telegraf`); on Hermes telegraf doesn't load → the base is undefined →
// "Super expression must be null or a function" → agent boot fails. household/src re-exports
// it, so it lands in the RN bundle. extraSubpathResolvers run AFTER the generic @canopy
// handler (which resolves the REAL file first), so the shim must intercept here. Mirror of
// the web vite alias.
const _presetResolve = _cfg.resolver.resolveRequest;
_cfg.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@canopy/chat-agent/bridges/telegram') {
    return { filePath: path.resolve(__dirname, 'src/shims/telegramBridge.js'), type: 'sourceFile' };
  }
  // react-native-webrtc: optional rendezvous (direct WebRTC) — native module not in this dev
  // APK; the loader's try/catch can't suppress the native error on Hermes (redbox). Stub it so
  // loadRendezvousRtcLib() returns null and the app runs over relay/nkn. (Install the native
  // dep + rebuild to enable direct WebRTC.)
  if (moduleName === 'react-native-webrtc') {
    return { filePath: path.resolve(__dirname, 'src/shims/reactNativeWebrtc.js'), type: 'sourceFile' };
  }
  return _presetResolve
    ? _presetResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = _cfg;
