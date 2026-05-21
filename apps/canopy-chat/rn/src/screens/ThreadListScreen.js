/**
 * canopy-chat-rn — ThreadListScreen.
 *
 * Per the platform-parity convention: same ThreadStore semantics
 * as web's threadSidebar.js; native FlatList rendering instead of
 * pure DOM.  Connects to a single shared ThreadStore + EventRouter
 * passed via context (see ServiceContext pattern in folio-mobile /
 * tasks-mobile).
 *
 * v0.2.5 ships the SHAPE — function signature + import surface —
 * not the runnable UI.  React-native + react-navigation imports are
 * present so the wiring is legible; the file does NOT compile under
 * the workspace's web tsconfig because React Native isn't on the
 * web bundler.
 *
 * Mark as RN-only via the *.rn.js convention?  No — RN apps in
 * canopy-mono use plain .js + .jsx and rely on metro to pick up the
 * RN modules.  This file is reachable only via metro / Expo, never
 * Vite.
 */

/* global console */

// SCAFFOLD-ONLY: real implementation imports react + RN primitives
// (View, Text, FlatList, Pressable) + react-navigation hooks.

/**
 * @param {object} props
 * @param {import('@canopy-app/canopy-chat').ThreadStore} props.store
 * @param {(threadId: string) => void}                    props.onSelect
 */
export function ThreadListScreen(props) {
  // v0.2.5 scaffold — the body uses React + RN primitives once
  // navigation + Expo are wired.  Until then, document the planned
  // shape:
  //
  //   const threads = useObservedThreads(props.store);
  //   return (
  //     <View style={styles.container}>
  //       <Header title={t('sidebar.heading')} />
  //       <FlatList
  //         data={threads}
  //         keyExtractor={(t) => t.id}
  //         renderItem={({item}) => (
  //           <Pressable onPress={() => props.onSelect(item.id)}>
  //             <Text>{item.name}</Text>
  //             <Text>{describeFilter(item.filter)}</Text>
  //           </Pressable>
  //         )}
  //       />
  //       <NewThreadButton onPress={...} />
  //     </View>
  //   );
  if (typeof console !== 'undefined') console.warn('ThreadListScreen: not yet implemented');
  return null;
}
