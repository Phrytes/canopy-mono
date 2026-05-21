# H5 V2 — remaining product items (post-Phase 7 SDK work)

> **Status:** scope + design notes captured 2026-05-04 after Phase 7 SDK
> work landed (steps 4 + 5 done; step 7 decided). The substrate +
> relay layer is now ready for the H5 product UI; what's below is the
> implementation scope for a focused follow-up session.
>
> **Companion docs:**
> - [`H5-V2-resume.md`](./H5-V2-resume.md) — original V2 resume plan.
> - [`Project Files/Substrates/apps/H5-neighborhood.md`](../Substrates/apps/H5-neighborhood.md) — H5 spec.
> - [`Project Files/Substrates/refactor/01-Execution-Checklist.md`](../Substrates/refactor/01-Execution-Checklist.md) — Phase 7 status.

---

## What's already in place

After Phase 3-6 + Phase 7 steps 4 + 5, the following infrastructure is
shipped + tested and ready for the UI to compose:

| Surface | Where | Notes |
|---|---|---|
| Agent factory | `apps/neighborhood-v0/src/Agent.js` `createNeighborhoodAgent` | Returns `{agent, itemStore, members, skillMatch, notifier}` — the substrate composition. |
| Skill registration | `apps/neighborhood-v0/src/skills/index.js` | `postRequest`, `acceptResponder`, `cancelRequest`, `listMyRequests`, `listOpen`, `resolveMember`. |
| Localhost-A2A host | `mountLocalUi(bundle.agent)` from `@canopy/agent-ui` | Wraps `core.A2ATransport` on `127.0.0.1`; exposes skills over A2A wire shape (`POST /tasks/send`, SSE subscribe, agent-card discovery). |
| Localhost-A2A client | `LocalAgentClient` from `@canopy/agent-ui` | Node-shape client speaking the A2A wire. |
| Relay + group-publish | `@canopy/relay`'s `startRelay({port})` | Closed-group fan-out + topic-aware queueing. |
| Group auth | `GroupManager.issueProof(memberPubKey, groupId)` (core) + `acceptedGroups` (relay) | Group membership tokens. |
| Member roster | `MemberMap.fromPodConfig({podClient, configUri})` (`@canopy/identity-resolver`) | Persistent webid → pubKey + display-name map from a pod-stored config. |
| Push wake (code-side) | `relay.PushSender` + `react-native.MobilePushBridge` | Real-device validation deferred to Phase 8. |

**What's missing** for end-user H5 are: a web UI, an invite/onboarding
flow, and a multi-group-membership UX.

---

## Item 1 — Per-member web UI (V0 scope)

**Goal:** an end-user can open a browser, see open requests in their
group, post a new request, and accept/decline claims on their own
requests.

**Architectural shape:**

```
Browser (HTML+JS)
   │
   │  POST /tasks/send  +  GET /events  (SSE)   ← A2A wire shape
   ▼
mountLocalUi(bundle.agent)                       ← wraps core.A2ATransport
   │                                                bound on 127.0.0.1:<port>
   ▼
core.Agent
   │  (skills: postRequest / acceptResponder / listOpen / listMyRequests)
   ▼
substrates (item-store, skill-match, identity-resolver, notifier)
```

The web UI is a **static HTML/JS frontend** served by the same Node
process that runs `mountLocalUi`, so Same-Origin policy lets the
browser POST to `/tasks/send` without CORS gymnastics.

**Implementation steps** (~2 days):

1. **Add a static-file directory** to `mountLocalUi`'s server. Today
   `core.A2ATransport` exposes the A2A endpoints only; extend
   `mountLocalUi` (`packages/agent-ui/src/server/mountLocalUi.js`)
   with an optional `staticDir` option that serves files from a
   directory under `/`. (The relay already has this pattern — see
   `serveStaticDir` in `packages/relay/src/server.js`.)
2. **Build the static frontend** under `apps/neighborhood-v0/web/` with
   three pages:
   - `index.html` — open requests list + "post new" form (calls `listOpen` + `postRequest`).
   - `mine.html` — my own requests list with claim approvals (calls `listMyRequests` + `acceptResponder`).
   - `style.css` — minimal but functional.
   The frontend uses `fetch()` directly against the A2A endpoints — no
   `LocalAgentClient` (that's Node-shape). Each skill call is a
   `POST /tasks/send` with the A2A JSON-RPC envelope.
3. **SSE for live updates**: `GET /events` subscribes to the agent's
   event stream; UI re-renders on `item-added` / `item-completed`.
4. **Auth (V0 simplification):** `mountLocalUi` is bound to
   `127.0.0.1`, so any process on the same machine has access. No
   browser-side auth in V0; deferred to V1 (cap-token-in-cookie or
   OAuth-PKCE flow).
5. **Tests:** smoke-test that the static frontend renders + a couple
   of `fetch()`-driven skill calls work end-to-end. Use
   `apps/neighborhood-v0/test/web.test.js` over a real `mountLocalUi`
   + a headless fetch.

**Out of scope for V0:** authentication, mobile-responsive layout,
WebRTC for live SSE-without-polling, accessibility.

---

## Item 2 — Onboarding (invite-link → group-token)

**Goal:** a group admin generates an invite link, sends it to a new
member out-of-band (chat / SMS / email), the new member opens the
link, the app provisions an identity + receives a group proof + joins
the group.

**Architectural shape:**

```
Admin: GroupManager.issueInvite(groupId, ttlMs) → invite-token
Out-of-band channel: invite-token gets to the new member
New member opens link http://<admin>/join?invite=<token>
   ↓
   Admin's server validates the invite, mints a member-specific group
   proof signed under the admin's identity, returns it to the new member
   along with the group's pod-config URL.
   ↓
   New member's app: AgentIdentity.generate() (or restore from mnemonic),
                     RelayTransport.connect(relayUrl, {groupProof}),
                     skillMatch.start() (with peers from MemberMap.fromPodConfig).
```

**Design decisions to lock:**

1. **Identity bring-up flow.** Two options:
   - (a) Mnemonic at first run — every member is a self-sovereign
     identity-from-day-one. Heavier UX, full Solid-pod compat.
   - (b) Ephemeral keypair on join — pubKey-only identity tied to the
     device. Lighter UX, no pod required for V0. **Lean: (b) for H5
     V0**, with V1 mnemonic-upgrade path. H5's V0 README already says
     "non-anonymous" but doesn't require pod-rooted identity.
2. **Invite-token format.** Use `GroupManager.issueProof(memberPubKey,
   groupId)`'s shape — but the invite is *unbound* (no member pubKey
   yet). Either:
   - (a) Issue a generic capability token "anyone with this token can
     redeem within TTL"; admin's server validates + mints the actual
     proof on redemption.
   - (b) Pre-issue a per-prospective-member proof and embed the member
     pubKey in the link (admin knows the member out-of-band).
   - **Lean: (a)** — closer to standard invite-link UX.
3. **Pod-config update.** After redemption, the new member's webid +
   pubKey + display-name need to land in the group's
   `<group>/config.json` (read by `MemberMap.fromPodConfig`). Either
   the admin writes immediately on redemption (requires admin's pod
   credentials in the redemption server), or the new member writes
   to a member-pod and a federated reader resolves it (heavier).
   **Lean: admin writes** — simplest and matches the "admin owns the
   group config" design.

**Implementation steps** (~3 days):

1. **`GroupManager.issueInvite(groupId, ttlMs)`** — new method on
   `@canopy/core`'s GroupManager. Returns a signed unbound capability
   token.
2. **Admin redemption server** — `apps/neighborhood-v0`'s
   `mountLocalUi` adds a `/join` route that:
   - Validates the invite (signature + TTL + groupId).
   - Accepts a `{memberPubKey, displayName}` body.
   - Issues a `GroupManager`-signed proof for the member.
   - Writes the new member's record into `<group>/config.json` (if
     admin has pod write credentials) or queues for manual append.
   - Returns `{groupProof, podConfigUri}`.
3. **New-member client** — a small HTML/JS page (under `web/onboard/`)
   that:
   - Generates an ephemeral keypair.
   - POSTs `{memberPubKey, displayName}` to `/join?invite=<token>`.
   - Stores the returned proof in localStorage (V1: in `KeychainVault`).
   - Redirects to the main UI.

**Out of scope for V0:** revocation (invite-after-the-fact), TTL
extension, multi-use invites, federated-reader pod-config resolution.

---

## Item 3 — Group switcher (multi-group membership UX)

**Goal:** a single user can be a member of multiple closed groups
(neighborhood + workplace + book club) and switch between them in the
UI.

**Architectural shape (decision):**

Two viable models:

- **(a) One agent, many groups.** A single `core.Agent` registers with
  the relay using one connection but presents multiple `groupProof`
  tokens (one per group). The relay's `clientsByGroup` would track the
  agent under each group separately. Apps switch the active group at
  the UI level only; the underlying SkillMatch instances run in
  parallel.
- **(b) One agent per group.** Separate `core.Agent` instances per
  group (each with its own pubKey or with a shared identity), each
  with its own RelayTransport connection + SkillMatch instance. Apps
  switch by activating a different agent.

**Trade-off:**

- (a) is more efficient (one WS connection, shared identity, less
  state) but breaks the relay's current "one groupProof per register"
  contract — the relay would need a multi-group register handshake.
- (b) is heavier (N connections, N agents, harder identity reuse) but
  fits the existing substrates without changes.

**Lean: (b) for V0** — fits the existing substrates without protocol
changes. V1 can collapse to (a) if the connection-overhead is real.

**Implementation steps** (~2 days):

1. **`createNeighborhoodAgent` to accept a list of groups.** Refactor
   to return `{agentsByGroup, defaultGroup, ...}` instead of a single
   `{agent, skillMatch}`. Each entry has its own SkillMatch + member
   roster.
2. **UI group switcher.** Top-bar dropdown that activates one group at
   a time. The active group's skills are what the UI calls.
3. **Identity reuse.** Use the same `AgentIdentity` (pubKey) across
   groups; each `core.Agent` holds the same identity, just with a
   different `groupProof` at relay-register time.
4. **Tests.** Two-group scenario in
   `apps/neighborhood-v0/test/multigroup.test.js`: identity X joins
   groups A + B, posts a request to A, confirms B doesn't see it,
   switches active group to B, posts to B, confirms A doesn't see it.

**Out of scope for V0:** group discovery (apps know their groups
out-of-band), per-group display-name overrides, group deletion UX.

---

## Suggested implementation order

The three items are independent enough to ship in any order, but a
sensible flow is:

1. **Per-member web UI** first — surfaces a usable H5 to a single
   group-of-one user, validates the substrate-on-A2A path in a
   browser context.
2. **Group switcher** next — small refactor of `createNeighborhoodAgent`,
   directly extends the UI from #1.
3. **Onboarding** last — the most design-dependent item; benefits
   from #1 + #2 being shipped (so the redemption flow has somewhere
   to land the new member).

Total estimate: ~7 days of focused work, mostly UI implementation.

---

## Cross-cutting decisions parked here

- **Web UI auth (V1):** cap-token-in-cookie vs OAuth-PKCE. Defer
  until UI ships.
- **Mobile RN client:** V3, separate cycle. The web UI ships first;
  RN takes the same A2A wire shape but uses `LocalAgentClient` over
  the in-process A2ATransport rather than via HTTP.
- **Anonymity protocol (Q-H5):** still parked. V0 ships
  non-anonymous; the V1+ anonymity model is a separate design cycle.
