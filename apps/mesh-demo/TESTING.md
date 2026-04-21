# Installing and testing mesh-demo on Android

## APK vs Expo — what we use

We use **Expo EAS Build** (cloud build → APK download).

- No Android SDK required on your laptop
- Builds in ~10 minutes on Expo's free cloud servers
- Gives you a direct **APK download link** you can open on both phones
- One APK installs on any Android device (no USB needed)

Expo Go is NOT used — the app has custom native modules (BLE, keychain)
that require a real build.

---

## One-time setup

### 1. Create a free Expo account

Go to https://expo.dev/signup and create an account (free tier is fine).

### 2. Install the EAS CLI

```bash
npm install -g eas-cli
```

### 3. Log in from this machine

```bash
eas login
# Enter your Expo email + password
```

### 4. Link this project to your Expo account

```bash
cd /home/frits/expotest/nkn-test/apps/mesh-demo
eas init
# Accept the suggested project name "mesh-demo"
# This writes your projectId into app.json — only needed once
```

---

## Building the APK

```bash
cd /home/frits/expotest/nkn-test/apps/mesh-demo
npm install          # install all dependencies first
eas build -p android --profile preview
```

What happens:
1. EAS uploads your code to Expo's build servers (~30 seconds)
2. Expo builds the APK in the cloud (~8–12 minutes)
3. When done, the CLI prints a **download URL** and a **QR code**

---

## Installing on both phones

When the build finishes you'll see something like:
```
✅ Build finished.
🤖 Android APK: https://expo.dev/artifacts/eas/xxxx.apk
```

**Option A — QR code (easiest):**
- Point each phone's camera at the QR code the CLI shows
- Android will open the APK download page → tap Install

**Option B — Direct link:**
- Open the URL on each phone's browser → tap Download → tap Install
- You may need to allow "Install from unknown sources" in Android settings

**Option C — `adb install` (if you later get Android SDK):**
```bash
adb install app-preview.apk
```

---

## Enabling "Install from unknown sources" on Android

Before installing, each phone needs to allow APK installs from the browser:

- **Android 8+**: Settings → Apps → your browser (e.g. Chrome) → Install unknown apps → Allow
- **Or** when prompted during install, tap "Settings" → toggle Allow

---

## Running the relay hop test

You need three participants: **Laptop** (browser), **Phone-A**, **Phone-B**.

### Setup
1. Install the APK on both phones
2. Make sure **Phone-A** and the laptop are on the **same WiFi network**
3. Make sure **Phone-A** and **Phone-B** are within **Bluetooth range** (~10m)
4. Open the app on both phones — they start advertising and scanning immediately

### What to expect

```
Phone-A peer list:            Laptop peer list (after gossip):
  📶 Laptop    direct           📶 Phone-A  direct
  🔵 Phone-B   direct           🔵 Phone-B  1 hop via Phone-A
```

### Send a relay-hop message

1. On Laptop: open a browser demo page (`packages/core/demo-dot.html` or similar)
2. Or add a simple invoke call in the browser console once the laptop agent is connected:
   ```js
   // In the browser console, after connecting to the relay:
   await pullPeerList(agent, phoneAPubKey);         // trigger gossip manually
   // Phone-B should now appear in the peer list
   const result = await invokeWithHop(agent, phoneBPubKey, 'receive-message',
     [{ type: 'TextPart', text: 'Hello from laptop via Phone-A!' }]);
   ```
3. The message appears on **Phone-B**'s MessageScreen
4. Phone-B's bubble shows: `1 hop via <phoneA-short-key>… ✓`

### What confirms the relay is working

- Phone-B has **no WiFi connection** (turn WiFi off to be sure)
- The message still arrives on Phone-B
- Phone-B's peer list does NOT show the laptop
- Phone-A's peer list shows BOTH the laptop AND Phone-B

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Build fails with "project not found" | Run `eas init` first — it writes the projectId into app.json |
| "Install blocked" on phone | Enable "Install from unknown sources" for your browser (see above) |
| BLE not scanning | Grant Location permission when the app asks — Android requires it for BLE scanning |
| Peers not appearing | Give it 10–20 seconds; mDNS can be slow on some Android WiFi drivers |
| WiFi peers not showing | Make sure both devices are on the **same** WiFi network (not guest vs main) |
| App crashes on start | Run `eas build --profile preview` again — the first build sometimes has a cache issue |

---

## Rebuilding after code changes

```bash
cd apps/mesh-demo
eas build -p android --profile preview
```

EAS caches the native layer — subsequent builds that only change JS are faster (~3 min).
