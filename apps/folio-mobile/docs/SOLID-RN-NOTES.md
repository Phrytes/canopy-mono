# SOLID-RN-NOTES (moved)

**The polyfill / bring-up trap catalogue is now maintained in the
`@onderling/react-native` substrate package:**

→ [`packages/react-native/docs/BRING-UP-NOTES.md`](../../../packages/react-native/docs/BRING-UP-NOTES.md)

Companion docs in the same directory:

- [`packages/react-native/docs/VERSION-MATRIX.md`](../../../packages/react-native/docs/VERSION-MATRIX.md) — pinned versions (Expo / RN / React / rn-webrtc / polyfill packages) + bump policy.
- [`packages/react-native/docs/PER-SUBSTRATE-CHECKLIST.md`](../../../packages/react-native/docs/PER-SUBSTRATE-CHECKLIST.md) — guidance for substrate authors adding RN variants.

## Why moved

This doc started life as Folio's mobile bring-up notes (drafted
2026-04-30 against the `track-H-folio` branch).  When the
`@onderling/react-native` package expanded into the RN-platform-layer
substrate (Phase B step 1, 2026-05-02), the trap catalogue moved into
the substrate so future RN apps inherit the same knowledge without
copy-pasting from Folio.

The substrate doc is the canonical going-forward reference.  This
file remains as a redirect for code comments + design docs that
reference the old path.

When new traps surface during a future RN bring-up, append them to
the substrate's BRING-UP-NOTES.md — not here.
