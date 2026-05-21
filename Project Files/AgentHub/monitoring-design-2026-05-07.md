# Hub-side app monitoring (2026-05-07, seed)

> Status: **idea-capture / seed doc**. Detailed design + coding plan
> follow when the Hub fundament lands and a closed-beta has revealed
> what should actually be tracked.
>
> Companion to [`agent-hub-design-2026-05-05.md`](./agent-hub-design-2026-05-05.md).

## What this is

A monitoring + audit layer that lets the **end user** see *everything*
their agent-SDK apps do — every skill invocation, every transport
send, every pod write, every external HTTP call — and gives the
**Hub** cross-app visibility so it can:

- detect apps that misbehave (malicious developer, regressed update),
- spot capability creep (an app suddenly making network calls it didn't declare in its manifest),
- give users a one-stop "what has my agent been doing?" timeline.

This is end-user empowerment first, security-defence second. The user
who opts into the Hub gets a real audit trail back; standalone-app
users keep their existing local-only model with no mandatory call-home.

## Why this matters

Three audiences benefit:

1. **End users** can check exactly which contacts an app contacted, what data left their device, and to whom. Lowers trust risk for unfamiliar apps.
2. **App developers** can ask users to share logs to debug issues without standing up custom telemetry. The user owns the redaction.
3. **The Hub** can flag rogue apps — the developer of "FreeSudoku-decentralised" probably shouldn't be uploading the user's contacts to their server.

## Layered architecture

| Layer | What | Lives in | Effort | Status |
|---|---|---|---|---|
| **L1 — Event-stream substrate** | Every SDK operation emits a structured event (`{at, app, kind: 'skill\|send\|pod-write\|external-fetch', subject, parts?, peer?, url?, bytes?}`) on `agent.on('audit', ...)`. Pure additive. | `@canopy/core` (additive — Emitter layer that all primitives feed into) | **2-4 days** | Not started; bouwsteen voor L2-L4 |
| **L2 — Local audit viewer** | Per-app screen showing the event-stream with filters (kind / time / peer / external host). Stoop's `/metrics.html` is a precursor; could grow into `/audit.html`. | each app | 1 day per app | Stoop has metrics today; audit is a small extension |
| **L3 — Hub mirror** | Hub subscribes to each hosted app's event-stream over an authenticated channel. Stored locally on the Hub (encrypted with a key only the user has). | `@canopy/agent-hub` (when it exists) | medium; depends on Hub fundament | Greenfield |
| **L4 — Hub-side analysis** | Cross-app correlation: "App X claimed it only needs Solid pod access; observed external HTTP to api.example.com 30×/hour. Flag for user review." Capability-manifest violation detection. | Hub | bigger; comes later | Far-future |

L1 is the cornerstone — once the event-stream exists, L2/L3/L4 can each be built independently and the user can opt in or out.

## What gets logged (proposal)

Five event kinds:

```js
{ at, app, kind: 'skill', skillId, partsSummary, from, ok }
{ at, app, kind: 'send',  to, transport, bytes }
{ at, app, kind: 'pod-write',     path, bytes, etag }
{ at, app, kind: 'pod-read',      path, bytes }
{ at, app, kind: 'external-fetch', method, host, path, bytes, ok, declared }
```

Notably **excluded** from the log by default:
- Message bodies (`parts`) — these are user content, redaction needed.
- Pod read contents.
- Any data that would let a snooper-with-the-log recreate the user's posts/chats.

What the log does carry: **shape and scale** — how many of each event, to/from whom, when. That's enough to detect capability creep, debug performance, and audit "did this app contact a third party?".

Per-event opt-in for richer detail: the user can flip a toggle "include skill argument summaries" for a specific app while debugging.

## Capability manifest (companion concept)

Every app ships with `agent-app.json`:

```json
{
  "name": "Stoop",
  "version": "2.0.0",
  "capabilities": {
    "skills": ["postRequest", "respondToItem", "..."],
    "external-hosts": ["nominatim.openstreetmap.org"],
    "pod-paths": ["mem://stoop/**"]
  }
}
```

Hub cross-checks the runtime event-stream against the declared manifest:
- `external-fetch` to a host **not** in `external-hosts` → flag.
- `pod-write` to a path outside the declared namespace → flag.

This mirrors the mobile-app permissions model. The user installs Stoop, sees "this app wants: pod access (your stoop/ container), one external host (Nominatim for geocoding), no cookies, no telemetry" → grant or deny.

## Trust model

- **Standalone apps** (no Hub) keep their existing model: log stays local; the app may or may not expose it. No platform-level enforcement.
- **Hub-hosted apps** are bound by the manifest. Hub is the trust authority.
- The Hub itself is open-source and the user runs it; "trust the Hub" reduces to "trust your own infrastructure".

This is the same trade the Solid model makes: the user owns their audit data, on their own infrastructure.

## Open questions

1. **Event-stream cost**: how much overhead does emitting an event per SDK call add? Hot path is skill dispatch + transport sends; want zero cost for users who don't subscribe. Solution: lazy event emission (only construct the event object when `agent.listenerCount('audit') > 0`).
2. **Redaction**: who decides what gets logged in `partsSummary`? Default-conservative (just shape/byte count); apps can opt into richer per-call.
3. **Retention on Hub**: how long does the Hub keep events? User-configurable; default 30 days?
4. **L4 alerts UX**: when the Hub detects a manifest violation, how loud is the alert? Soft (badge on the app) vs hard (block the call until user re-confirms)? Settings.
5. **Standalone apps vs Hub apps**: is there a path where standalone apps can also opt into a "send my logs to a developer who asks" without going through a Hub? Probably yes — encrypted-blob-export-on-user-action, like the encrypted-backup pattern (Stoop V1 Phase 13.6).

## Order in the broader plan

This is **V2.5+ work** — not blocking Stoop V2 or the V3 mobile build. Sensible ordering:

1. Stoop V2 ships (Phases 23-30, current plan).
2. **Layer 1 substrate** is added to `@canopy/core` — can land before the Hub exists.
3. Stoop adds an `/audit.html` (Layer 2) — first concrete consumer of L1.
4. Hub fundament lands.
5. Hub-mirror (Layer 3) is built; cross-app analysis (Layer 4) follows.

Layer 1 is the deferrable item that has the highest leverage — it costs days and unlocks weeks of follow-on work.

## Companion project

The agent-SDK browser ([`../AgentBrowser/design-2026-05-07.md`](../AgentBrowser/design-2026-05-07.md)) is the related-but-separate idea: where this monitoring layer lives at the SDK level, the browser provides a *runtime* sandbox enforcing capability manifests at process boundaries. They overlap (both depend on the manifest concept) but are independently useful — a user can run the browser without the Hub, and vice versa.

## Reference

- [`agent-hub-design-2026-05-05.md`](./agent-hub-design-2026-05-05.md) — base Hub design (lite / fat attachment models)
- [`../AgentBrowser/design-2026-05-07.md`](../AgentBrowser/design-2026-05-07.md) — sibling project
- [`../Stoop/coding-plan-v2-2026-05-07.md`](../Stoop/coding-plan-v2-2026-05-07.md) — Stoop V2 (current focus)
