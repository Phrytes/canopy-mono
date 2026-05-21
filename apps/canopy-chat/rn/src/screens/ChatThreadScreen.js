/**
 * canopy-chat-rn — ChatThreadScreen.
 *
 * Renders the active thread's message stream + input.  Same
 * RenderedReply data structure as web's domAdapter; a new
 * RN-specific renderer (FlatList of messages + RN Pressable for
 * inline keyboards) consumes it.
 *
 * v0.2.5 — SCAFFOLD only.
 */

/* global console */

// SCAFFOLD-ONLY: real implementation imports react + RN primitives
// (View, Text, FlatList, KeyboardAvoidingView) + a MessageBubble
// component sibling to web's domAdapter.

/**
 * @param {object} props
 * @param {import('@canopy-app/canopy-chat').Thread}    props.thread
 * @param {(text: string) => Promise<void>}             props.onSend
 * @param {(opId: string, itemId: string) => Promise<void>} props.onButtonTap
 */
export function ChatThreadScreen(props) {
  // Planned shape:
  //
  //   const messages = useObservedMessages(props.thread);
  //   return (
  //     <KeyboardAvoidingView style={styles.container}>
  //       <ThreadHeader name={props.thread.name} filter={props.thread.filter} />
  //       <FlatList
  //         data={messages}
  //         keyExtractor={(m, i) => m.messageId ?? `u-${i}`}
  //         renderItem={({item}) => (
  //           <MessageBubble message={item} onButtonTap={props.onButtonTap} />
  //         )}
  //         contentContainerStyle={styles.stream}
  //         inverted
  //       />
  //       <InputBar onSubmit={props.onSend} />
  //     </KeyboardAvoidingView>
  //   );
  if (typeof console !== 'undefined') console.warn('ChatThreadScreen: not yet implemented');
  return null;
}
