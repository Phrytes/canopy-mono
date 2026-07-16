# tasks-mobile — React Navigation screen inventory

> **Slice C prep (PLAN-gui-chat-uplift.md).**  Recon-only — no code
> touched.  Pre-feeds Slice C (`tasks-mobile → renderMobile`) by
> mapping today's screens to the manifest model + flagging gaps.

---

## 1. Navigation topology

**File:** `apps/tasks-mobile/App.js:89–331`

Two-tier model: **outer stack** (Welcome / Main / detail-modals) +
**inner tab navigator** (Workspace, MyWork, Review, Inbox, Circles).

```javascript
const Stack = createNativeStackNavigator();
const Tabs  = createBottomTabNavigator();

function MainTabs() {
  return (
    <MainMenuProvider>
      <Tabs.Navigator>
        <Tabs.Screen name={ROUTES.Workspace} component={WorkspaceScreen} />
        <Tabs.Screen name={ROUTES.MyWork}    component={MyWorkScreen} />
        <Tabs.Screen name={ROUTES.Review}    component={ReviewScreen} />
        <Tabs.Screen name={ROUTES.Inbox}     component={InboxTabScreen} />
        <Tabs.Screen name={ROUTES.Circles}     component={CirclesDashboardScreen} />
      </Tabs.Navigator>
    </MainMenuProvider>
  );
}
```

Outer stack: Welcome → onboarding screens → MainTabs.  Detail screens
push over MainTabs.  Compose uses `presentation: 'modal'`.  Deep
links via `tasks://...` parsed in `DeepLinkHandler`.

---

## 2. Per-screen inventory (36 screens)

### Workspace tab + detail/modal (3 screens)

- **WorkspaceScreen** — open-tasks list w/ status filters + FAB.
  Skills: `listOpen`.  **NavModel:** view `open` ✓.
- **TaskDetailScreen** — full lifecycle + admin/master CTAs.
  Skills: `listOpen`, `getDagTree`, `claimTask`, `submitTask`,
  `completeTask`, `approveTask`, `rejectTask`, `revokeTask`,
  `reassignTask`, `removeTask`, `forceSpawnSubtask`,
  `forceCompleteTask`.
  **NavModel:** 7 of 9 ops covered; `forceCompleteTask` +
  `forceSpawnSubtask` missing.
- **ComposeScreen** — modal create-task form.
  Skills: `addTask`, `addSubtask`, `proposeSubtask`,
  `forceSpawnSubtask`, `listOpen` (deps picker).
  **NavModel:** `addTask` ✓; `addSubtask`/`proposeSubtask`/
  `forceSpawnSubtask` MISSING.

### MyWork tab (2 screens)

- **MyWorkScreen** — three sections (assigned / mastered / claimable)
  + planner cards.  Skills: `listMine`, `listMyMasteredTasks`,
  `listClaimable`.  **NavModel:** `listMine` (view `mine`) +
  `listClaimable` ✓; `listMyMasteredTasks` MISSING.
- **SubmitScreen** — DoD-aware submission (photo via `pickAndResize`
  / text-only).  Skills: `submitTask`, `listOpen`.  **NavModel:** ✓.

### Review tab (1 screen)

- **ReviewScreen** — reviewer queue w/ inline approve/reject.
  Skills: `listAwaitingApproval`, `approveTask`, `rejectTask`.
  **NavModel:** approve/reject ✓; `listAwaitingApproval` MISSING (no
  view).

### Inbox tab (1 screen)

- **InboxScreen** — per-kind event renderer + clear actions.
  Skills: `listMyInbox`, `approveSubtaskProposal`,
  `declineSubtaskProposal`, `approveSubtaskRequest`,
  `declineSubtaskRequest`, `clearInboxItem`, `clearInbox`.
  **NavModel:** all 7 MISSING.

### Circles tab (1 screen)

- **CirclesDashboardScreen** — V2.5 cross-circle dashboard + counters +
  Jump-in.  Skills: `getMyCircles`.  **NavModel:** MISSING (cross-circle
  view not in manifest).

### Navigation / DAG (1 screen)

- **DagScreen** — sub-task tree, flat indented list.  Skills:
  `getDagTree`.  **NavModel:** MISSING (structure query).

### Settings / Admin (9 screens)

- **AvailabilityScreen** — V2.3 7×2 grid.  Skills:
  `getMyAvailability`, `setMyAvailability`, `setAvailabilityOptIn`.
  **NavModel:** all MISSING.
- **ProfileMineScreen** — handle / avatar / skills edit + mnemonic
  reveal.  Skills: `getMyProfile`, `setMyHandle`, `setMyDisplayName`,
  `setMyAvatarUrl`, `setHolidayMode`.  **NavModel:** all MISSING.
- **ProfileOtherScreen** — read-only member profile.
  Substrate hook `useMemberProfile`.  **NavModel:** MISSING.
- **SettingsScreen** — per-device + shared settings + push opt-in.
  Skills: `setMyPushToken`.  **NavModel:** MISSING.
- **EditSkillsScreen** — Phase 41.18.3 skills editor.  Skills:
  `getMySkillsFormShape`, `editMySkillsForCircle`.  **NavModel:**
  MISSING.
- **CadenceOverridesScreen** — per-user cadence (Phase 41.18.3).
  Skills: `getMyCadenceOverrides`, `setMyCadenceOverrides`,
  `resolveMyCadence`.  **NavModel:** MISSING.
- **MetricsScreen** — diagnostics.  Skills: `getMetrics`.
  **NavModel:** MISSING.
- **PrivacyScreen** — closed-beta privacy notice.  Skills:
  `getPrivacyNotice`.  **NavModel:** MISSING.
- **CircleSettingsScreen** — 6 sub-panels (lifecycle, members, roles,
  bot bindings, calendar sync, etc.).  **NavModel:** per-section
  varies.

### Auth / Pod (2 screens)

- **PodSignInScreen** — Solid OIDC flow.  Substrate hook
  `useTasksAuth`.  **NavModel:** MISSING.
- **PodSettingsScreen** — pod & storage settings (M1-S4).  Skills:
  `setCircleStoragePolicy`, `signOutOfPod`, `podSignInStatus`.
  **NavModel:** MISSING.

### Circle creation (1 screen)

- **CreateCircleScreen** — 4-step wizard + storage-policy picker.
  Skills: `provisionMyCircle`, `joinCircle`.  **NavModel:** MISSING.

### Chat / appeals (1 screen)

- **ChatThreadScreen** — Phase 41.18.4 appeal-thread surface.
  Skills: `getChatThread`, `sendChatMessage`, `appealTask`.
  **NavModel:** all MISSING.

### Bot / integrations (1 screen)

- **IssueBotTokenScreen** — Phase 41.13 cap-token QR for chat
  binding.  Skills: `issueBotToken`.  **NavModel:** MISSING.

### Onboarding (5 screens)

- **WelcomeScreen / OnboardScanScreen / OnboardRestoreScreen /
  OnboardIssueScreen / AuthCallbackScreen** — first-run flow.
  Skills: `joinCircle`, `redeemInvite`, `restoreIdentity`,
  `issueInvite`.  **NavModel:** all MISSING (onboarding flow).

---

## 3. Manifest coverage summary

**Current tasks-v0 manifest:** 3 views (`open`, `mine`, `claimable`)
+ 12 operations (lifecycle ops).

**Coverage:** ~30% of tasks-mobile's surface.  Core task-lifecycle
ops covered.  Missing:

| Domain          | Missing ops                                                  | Count |
| --------------- | ------------------------------------------------------------ | ----- |
| Inbox           | listMyInbox, approve/declineSubtaskProposal/Request, clearInbox(Item) | 7 |
| Sub-tasks       | addSubtask, proposeSubtask, forceSpawnSubtask, forceCompleteTask | 4 |
| User profile    | getMyProfile, setMyHandle, setMyDisplayName, setMyAvatarUrl, setHolidayMode | 5 |
| Settings        | setMyPushToken, getMy/setMy Availability + AvailabilityOptIn, getMy/setMy CadenceOverrides, resolveMyCadence, getMetrics, getPrivacyNotice, getMySkillsFormShape, editMySkillsForCircle | 12 |
| Circle + Pod      | provisionMyCircle, setCircleStoragePolicy, signOutOfPod          | 3 |
| Chat + bot      | getChatThread, sendChatMessage, appealTask, issueBotToken    | 4 |
| Cross-circle      | getMyCircles, listMyMasteredTasks, listAwaitingApproval        | 3 |

**Total ops missing for full mobile parity: 38+.**

**Missing views:** reviewer queue (`listAwaitingApproval`),
`mastered` (mine.mastered section), `inbox`, `availability`, `dag`,
`circles`, `profile`, `settings`, `privacy`, `metrics`.

---

## 4. Risks / gotchas for Slice C

### Mobile-specific navigation features

- **Modals** (`ComposeScreen` uses `presentation: 'modal'`) — web
  NavModel has no modal abstraction; map to dialog/overlay pattern.
- **Bottom-tab shell** — heart of mobile UX; web likely needs a
  different shell (top nav / sidebar).
- **Tab badges** — `InboxTabBadgeBinder` (App.js:124–133) wires live
  badge count; NavModel has no badge concept yet (V1+ field?).
- **Deep links** — `tasks://...` parsed via React Navigation
  `linking`; web NavModel deep-link format TBD.

### Mobile-only or divergent screens

- Onboarding (5 screens) — mobile first-run only.
- **SubmitScreen** photo flow — camera/picker vs file-upload on web.
- **AvailabilityScreen** 7×2 grid — gesture-friendly; web layout TBD.
- **DagScreen** flat indented list — web could use visual tree/DAG.

### Shared components

`apps/tasks-mobile/src/components/`:
- `TaskCard` — reusable on web.
- `DeliverablePhoto` — wraps RN `<Image>`; web needs `<img>`.
- `MemberPickerSheet` — RN bottom sheet → web modal dialog.
- `PlannerCards` — V2.4; reusable.
- `MainMenu` — RN drawer; web hamburger or sidebar.
- `CircleSwitcher` — dropdown; reusable.

### State management

- `useSkill` + `useSkillResult` hooks — RN-specific via
  `@onderling/sync-engine-rn/react`.  Web needs parallel
  `@onderling/sync-engine-web/react`.
- `ServiceContext` — global; web may split for code-splitting.
- Pull-to-refresh via `<RefreshControl>` — web: refresh button or
  skeleton.

---

## 5. Recommended Slice C migration order

**Phase 1 — Core Workspace (read-only, manifest mostly ready):**
WorkspaceScreen, TaskDetailScreen, MyWorkScreen, DagScreen,
ReviewScreen.  Add: `listAwaitingApproval`, `listMyMasteredTasks`
views.

**Phase 2 — Task submission (form-heavy):** ComposeScreen,
SubmitScreen.  Add 4 sub-task ops to manifest.

**Phase 3 — Inbox & notifications (new feature):** InboxScreen.
Add 7 inbox ops.

**Phase 4 — User & circle settings:** ProfileMineScreen,
SettingsScreen, EditSkillsScreen, CadenceOverridesScreen,
AvailabilityScreen, CircleSettingsScreen, MetricsScreen, PrivacyScreen.
Add 15+ ops.

**Phase 5 — Pod & circle creation:** PodSignInScreen,
PodSettingsScreen, CreateCircleScreen.  Add 3 ops.

**Phase 6 — Chat & bot (optional V1):** ChatThreadScreen,
IssueBotTokenScreen.  Add 4 ops.

**Phase 7 — Onboarding (parallelizable with Phase 1):** 5 screens.

---

## Conclusion

tasks-mobile has **36 screens** organised around a five-tab shell +
detail/modal layer.  The tasks-v0 manifest covers ~30% of the
surface; Slice C requires **38+ new ops + ~10 new views** for full
parity.  Critical-path: Phases 1–3 (core workspace + submission +
inbox).  Settings & infrastructure can land later.
