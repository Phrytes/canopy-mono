# Web ≡ mobile — what may differ, what may not

The invariant (CLAUDE.md #2) says web and mobile are equals: one shared source, neither platform
primitive. This convention makes the invariant *practical* by naming the differences that are
legitimate. Anything different that is not covered here — or not listed in the exceptions table
below — is drift, i.e. a bug.

## May differ (platform idiom — no listing needed)

| axis | web idiom | mobile idiom |
|---|---|---|
| **Input & overlays** | dialogs, side panels, hover states | bottom sheets, FAB, long-press |
| **Platform services** | file picker, clipboard | camera/QR, share sheet, push notifications |
| **Navigation chrome** | tab bar / URL routing | stack navigation, back gesture |
| **Density & layout** | multi-column where wide | single-column, larger touch targets |
| **Fonts** | CSS token stacks | system families (undefined fontFamily = system default) |

The test for "idiom": the same op, the same name, the same consent flow — reached through a
different gesture.

## May NOT differ

- **Op coverage.** Every op a user can reach on one platform is reachable on the other, unless
  listed below with a reason and a date.
- **Vocabulary.** One concept, one name, both platforms — sourced from the shared locales
  (`apps/basis/src/locales/`), never platform-local strings for shared concepts.
- **Consent flows.** The same disclosure/consent steps in the same order. A platform may render
  a step differently; it may not skip, merge, or reorder steps.
- **Design tokens.** Colors, radii, spacing come from the shared `THEME` (src/v2/theme.js) on
  both platforms. Platform-local colour values are the drift this repo has been burned by.

## Current listed exceptions

| what | platform | why | since | exit path |
|---|---|---|---|---|
| QR **scanning** | mobile only | no camera API parity on desktop web; web shows the QR + paste-a-code path | 2026-05 | WebRTC camera capture, when worth it |
| Push notifications | mobile only | web-push exists but the privacy-preserving notification model is still designed, not built | 2026-06 | `plans/NOTE-notifications-model.md` |
| Legacy ChatScreen (invisible peer-wiring host) | mobile only | v1 residue; keeps inbound routing alive until the port lands | 2026-05 | retire with the chat-surface completion |
| Light/dark **toggle** — live recolour of *every* screen | web full; mobile partial | the systeem/licht/donker toggle + reactive theme context now ship on both (shared `themePref` contract, one storage key); on mobile the toggle recolours screens that read the theme via `useTheme()` at render (My-data) live, but the remaining v2 screens still build StyleSheets at module load so they adopt the resolved palette on their next mount | 2026-07 | convert the remaining module-level StyleSheets to render-time (`useTheme()` / `makeStyles(theme)`) screen by screen |

Add a row when you consciously ship a one-platform feature; remove it when parity lands. The
surface-coverage snapshot (`npm run coverage` in `apps/basis`) is the mechanical side of this
check — an op present in one platform's projector output and absent from the other's must have a
row here.
