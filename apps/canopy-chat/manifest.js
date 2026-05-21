/**
 * canopy-chat — own manifest.
 *
 * The chat shell composes OTHER apps' manifests at runtime via
 * `manifestMerge`.  Its own manifest declares ops the shell itself
 * owns (thread management, mute, etc.) — populated in phase v0.2+.
 * v0.1 ships a minimum manifest so the validator passes.
 *
 * Per `Project Files/canopy-chat/coding-plan.md` § Phase v0.1.
 */

export const canopyChatManifest = {
  app:        'canopy-chat',
  itemTypes:  ['chat-thread', 'chat-message'],
  operations: [],   // v0.2+ adds createThread / muteEvent / etc.
  views:      [],   // chat shell does not surface its own views in nav;
                    //   threads are managed via the chat UI, not a section
};

export default canopyChatManifest;
