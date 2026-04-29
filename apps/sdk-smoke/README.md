# sdk-smoke — two-device SDK smoke harness

A stripped-down Expo app that exposes each SDK substrate area as a press-button
test, used to validate that Tracks A–G survive on real hardware.

This app is **not** an end-user demo — it has no chat UI, no Folio, no styling
beyond what's needed to read a status pill.  See
[`../../coding-plans/sdk-two-device-smoke.md`](../../coding-plans/sdk-two-device-smoke.md)
for the full plan, the 10 scenarios (S1–S10), and the bring-up runbook.

## What's in here

```
apps/sdk-smoke/
├── App.js                       # one screen, one section per scenario
├── app.json                     # Expo config (ag.canopy.sdksmoke)
├── babel.config.js
├── metro.config.js              # mirrors mesh-demo's pinned RN/Expo wiring
├── index.js                     # registerRootComponent
├── package.json                 # @canopy-app/sdk-smoke; same Expo / RN versions as mesh-demo
├── shims/
│   ├── node-builtins.js         # empty shim for server-only Node modules
│   └── ws.js                    # forwards to globalThis.WebSocket
└── src/
    ├── components/
    │   ├── LogPane.js           # scrollable per-scenario log
    │   └── ScenarioRow.js       # title + Run button + status pill + log toggle
    ├── lib/
    │   ├── agent.js             # createSmokeAgent — mirrors mesh-demo's wiring
    │   └── config.js            # RELAY_URL, AGENT_LABEL, VAULT_SERVICE
    └── scenarios/
        ├── S1-bootstrap.js      # one stub per scenario
        ├── S2-vault-migration.js
        ├── S3-pod-sync-direct.js
        ├── S4-pod-sync-flap.js
        ├── S5-cap-share.js
        ├── S6-identity-rotation.js
        ├── S7-governance-demote.js
        ├── S8-skills-pubsub.js
        ├── S9-a2a-sealed.js
        ├── S10-battery-sleep.js
        └── index.js             # ordered registry
```

Each scenario file exports `{ id, title, run({ log, sdk }) }`.  The contract:

```js
export async function run({ log, sdk }) {
  log('S1: starting…');
  // ... do the SDK work ...
  return { status: 'pass' | 'fail' | 'pending' | 'degraded', detail: '...', durationMs };
}
```

Today every `run()` is a stub that returns `pending`.  Each scenario's logic
gets filled in **as it's actually run** on two devices — this is intentional;
the task is to give the harness a runnable shape now and to flesh in scenarios
during the hands-on session.

## Bring it up

> Before any of these commands, make sure the relay is running on the laptop
> with verbose logging:
>
> ```bash
> RELAY_VERBOSE=1 npm run relay:start
> ```

### On an Android emulator

1. Start an Android emulator (Pixel 6 / API 34 / x86_64 is known good — see
   the bring-up runbook in `coding-plans/sdk-two-device-smoke.md` for the AVD
   setup).
2. From `apps/sdk-smoke/`:
   ```bash
   npm install
   npx expo start --android
   ```
3. The emulator picks up Metro automatically; the app loads as a dev client
   build.  If Metro can't see the laptop's relay over the emulator loopback,
   set `RELAY_URL` in `src/lib/config.js` to `ws://10.0.2.2:8787`.

### On a real Android phone (USB or LAN)

1. **First time only:** build a dev client and sideload it.
   ```bash
   eas build --profile development --platform android
   ```
   Sideload the resulting `.apk` to the phone.
2. From `apps/sdk-smoke/`:
   ```bash
   npm install
   npx expo start
   ```
   Press `a` in the Metro CLI (or scan the QR) to attach the device.

> **Do NOT run `npx expo run:android`.**  Phone-A's existing mesh-demo dev
> build (CLAUDE.md gotcha) is at `com.canopy.meshdemo`, distinct from
> sdk-smoke's `ag.canopy.sdksmoke`.  `expo run:android` will install the
> wrong target onto the wrong build slot.  Stick to `expo start` + sideloaded
> dev client.

### On an iPhone

iOS is **deferred** per Q-Smoke.1 (locked 2026-04-29).  This README will be
updated when iOS coverage is on the table.

## Reading the harness

- Each row shows `id` + `title` + a status pill.  Statuses: `pending`,
  `running`, `pass`, `fail`, `degraded`.
- Press **Run** to fire the scenario.  Press **Show log** to expand the
  scrollable log pane underneath.
- The log pane is monospace and selectable so you can copy lines into the
  results doc.
- The harness pre-warms one shared agent on first **Run** (or on **Init
  agent** in the header).  All scenarios share that agent — there's only one
  Keychain row set per app session.

## Pairing with the relay's verbose log

When `RELAY_VERBOSE=1` is set on the relay, every hop appears as
`[verbose] <senderShort> → <recvShort> bytes=N type=<_p>`.  The leak
detector adds a `[verbose] potential plaintext leak: ...` line for any
forwarded envelope whose body looks like 20+ readable UTF-8 characters in
a row — this is the on-the-wire check S9 needs.

To pair a harness log with relay output, line the log pane and the relay
stdout up by wall-clock timestamp (the LogPane prints `hh:mm:ss.mmm` on every
line).

## Tests

This app has no unit tests today — its purpose is hands-on validation.  The
scenario stubs themselves return structured results so they're easy to
integrate into a test runner later if needed.

## Related

- [`../mesh-demo/`](../mesh-demo/) — the canonical phone messaging surface;
  this app deliberately doesn't extend it (Q-Smoke.3 locked 2026-04-29).
- [`../../packages/relay/`](../../packages/relay/) — verbose logging behind
  `RELAY_VERBOSE=1` (Part 3 of the prep).
- [`../../coding-plans/sdk-two-device-smoke.md`](../../coding-plans/sdk-two-device-smoke.md) — the plan.
