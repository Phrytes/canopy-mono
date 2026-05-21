Honest assessment, organized by what kind of problem each is.                            
                                         
  ---                                                                                      
  Blocking design gaps
                                                                                           
  These will stop implementation cold until resolved.       
                                                                                           
  1. First hello encryption bootstrap                                                      
                                                                                           
  The design says all payloads are nacl.box encrypted to the recipient's public key. But   
  nacl.box requires you to already have the recipient's public key. For NKN this is fine —
  the NKN address is derived from the public key, so you have it. For MQTT and WS relay you
   connect by topic or URL, not by public key. The very first hello has no key to encrypt
  to.

  This needs a decision: (a) hello is sent unencrypted, signed only, and encryption starts 
  after the key exchange completes — which means the relay and any passive observer sees
  the first hello payload; (b) hello uses an ephemeral DH key exchange (like Noise         
  protocol's handshake); (c) we require that all peers are known by public key before first
   contact (tightening the discovery model). Each option changes the security story and the
   complexity of SecurityLayer.

  2. Key recovery

  Ed25519 keypair = agent identity. Lose the device → lose the identity. There is no backup
   or recovery path designed. For a real multi-device user this is a dealbreaker. The vault
   backends (Bitwarden, SolidPod) are noted as future work, but they need to solve key     
  backup, not just storage. Key rotation is also deferred. This is fine for PoC but should
  at minimum be acknowledged as a known limitation with a sketch of the intended solution,
  otherwise you'll paint yourself into a corner in the vault implementation.

  3. Revocation propagation                                                                
   
  Token and group proof revocation says "issuer publishes a signed revocation envelope;    
  receivers cache locally." But how does it propagate? If Alice revokes Bob's token while
  Bob is offline, Bob's cached copy still works until he happens to contact Alice again.   
  There's no gossip mechanism for revocations, no required check-in interval, no revocation
   list endpoint. For short-lived tokens (1 hour) this is acceptable. For group proofs with
   multi-day expiry it's a real gap. Needs either a propagation design or a documented
  acceptable-risk tradeoff.

  ---
  Significant ambiguities
                                                                                           
  These are specified, but not specified enough to implement without making judgment calls
  that affect interoperability.                                                            
                                                            
  4. What "public card" means for gossip                                                   
                                                            
  The gossip privacy rule says "only share peers with public caps." Does a peer need at    
  least one public capability? Or does the agent card itself have a visibility level
  separate from its capabilities? A peer could have only authenticated caps and still want 
  to be discoverable. The gossip filter needs a clearer rule — probably a separate
  discoverable: true/false flag on the agent, independent of capability visibility.

  5. Streaming + SecurityLayer interaction

  Each ST/SE chunk: separately encrypted and signed, or a single nacl.box stream? If       
  separately: significant per-chunk overhead (box adds ~40 bytes overhead + Ed25519 sig =
  ~100 bytes per chunk, plus the nonce). If a single stream: nacl.box is not designed for  
  streaming — you'd need nacl.secretbox with a derived session key, which requires the
  handshake to be resolved first. For PoC overhead is probably fine, but the design should
  say which approach is used.

  6. Peer removal semantics

  maxPeers enforcement says unreachable peers are counted until "explicitly removed or     
  group proof expires." There's no agent.peers.remove() in the query API, and no policy for
   automatic cleanup (e.g. "remove peers unreachable for more than 30 days"). Without this,
   a long-running agent accumulates ghost peers that consume slots indefinitely.

  7. Agent file distribution and loading

  The agent file format is well-designed but the loading path for production use isn't     
  specified. Does the user host it themselves? Is it bundled with the app? Does the app
  generate it on first run? On React Native there's no filesystem path the user can easily 
  edit. The developer workflow for "user creates and maintains their agent file" needs a
  concrete answer.

  ---
  Hard technical challenges
                           
  These are specified well enough to implement, but they're genuinely difficult.
                                                                                           
  8. Cross-platform test coverage
                                                                                           
  The InternalTransport is excellent for unit testing the logic layer. But integration     
  tests that cover NKN + MQTT + WS across browser, Node.js, and React Native are expensive
  to write and maintain. Platform differences in crypto (SubtleCrypto vs node:crypto vs    
  react-native-quick-crypto), storage, and network behavior accumulate. Without good
  integration test infrastructure, bugs will hide at the platform boundaries. This is
  probably the biggest day-to-day maintenance burden.

  9. React Native native module ecosystem

  react-native-ble-plx, react-native-zeroconf, react-native-keychain — each of these has   
  its own maintenance cadence, iOS/Android behavior differences, and occasional breaking
  changes across React Native versions. Claude can write the adapter code well, but        
  debugging a crash inside a native module requires a developer with a device in hand. This
   is where the "Claude does most of it" assumption breaks down most clearly.

  10. UCAN delegation chain verification                                                   
   
  The capability token delegation (A → B → C) is conceptually clean, but implementation has
   edge cases: what if the intermediate token (B's grant from A) has been revoked? The
  verifier needs to walk the chain and check each link against the revocation cache — but  
  B's token was issued by A, and C's agent might not have A's revocation list. The chain
  could be 3-4 hops in theory. Getting this right without network round-trips during
  verification requires the revocation gap (point 3 above) to be resolved first.

  11. WebRTC in React Native

  PeerJSTransport is listed as pure JS but WebRTC in React Native requires                 
  react-native-webrtc, which is a native module. It also needs STUN/TURN server
  configuration for NAT traversal — the design doesn't specify who runs the TURN server or 
  how it's configured. Without TURN, WebRTC fails on symmetric NATs (common on mobile
  networks). This makes the rendezvous path unreliable on mobile without additional
  infrastructure.

  ---
  What's solid
              
  The layered architecture, the four primitives, SecurityLayer-always-on, the vault
  interface, the permission model, the envelope format — all of these are well-specified   
  and implementable in a straight line. The module boundaries are clean. Phases 1-4
  (transport through relay) are entirely within "Claude writes it, developer reviews and   
  tests" territory.                                         

  ---
  Feasibility: Claude + 1-2 developers
                                      
  Phases 1-4 (transport, agent layer, state/patterns, relay): Very realistic. Pure JS,
  well-specified interfaces, good test strategy via InternalTransport. Claude can produce  
  working code for most of this; the developer role is reviewing, writing integration
  tests, and resolving the design gaps above before hitting them in code. Rough estimate:  
  3-4 months of part-time work, assuming the bootstrapping gap (point 1) is resolved first.

  Phase 5 (React Native): Realistic but with higher variance. The pure JS parts work       
  unchanged. The native modules are where the estimate breaks down — debugging them
  requires a human with a device. Budget extra time here, especially for BLE.              
                                                            
  Phase 6 (protocol completions): Straightforward. File sharing and negotiation are        
  well-specified. GroupManager Ed25519 upgrade is a defined change.
                                                                                           
  The future items (Solid Pod, key rotation, user control layer): Each of these is a       
  significant project in its own right, especially Solid Pod (requires WebID-OIDC auth, LDP
   protocol) and key rotation (requires a broadcast mechanism and admin re-issuance).      
                                                            
  Where Claude is most useful: boilerplate, implementing well-specified interfaces, writing
   tests against InternalTransport, implementing protocol handlers, generating agent file
  examples, writing documentation. Where you need the developer: debugging native modules, 
  making judgment calls on the ambiguities above, cross-platform integration testing,
  security review of the crypto implementation.

  Biggest single risk: the nacl.box bootstrapping gap (point 1). It's a design question but
   it directly affects the most critical component (SecurityLayer) in Phase 1. If left
  unresolved it will require rework of the foundational layer. Worth settling that design  
  question before writing any security code.        