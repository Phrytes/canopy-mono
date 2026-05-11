/**
 * IHubBinding — promise-based wrapper around the AIDL binder.
 *
 * Wraps a native `bindingId` + the native bridge that knows how to
 * marshal method calls across the binder. Each method maps 1:1 to an
 * `IHub_V<negotiatedVersion>` AIDL method, with JS-friendly
 * argument shapes (envelopes/items as objects rather than JSON
 * strings; the native side serialises before the binder hop).
 *
 * Standardisation Phase 51.8.2 + 51.9.1.
 *
 * @typedef {object} BundleManifest
 * @property {string} bundleId
 * @property {string} displayName
 * @property {string[]} supportedTypes
 *
 * @typedef {object} Envelope        — matches notify-envelope's wire shape
 * @property {string} kind
 * @property {string} [ref]
 * @property {string} [etag]
 * @property {string} [fromActor]
 * @property {*}      [payload]
 */

export class IHubBinding {
  #nativeModule;
  #bindingId;
  #sessionId;
  #version;
  #closed = false;
  /** @type {Set<(envelope: object) => void>} */
  #envelopeSubscribers = new Set();
  /** @type {(() => void) | null} */
  #nativeCallbackUnsub = null;

  /**
   * @param {object} args
   * @param {object} args.nativeModule    — bind/callMethod/registerIncomingCallback/unbindService
   * @param {string} args.bindingId       — opaque id the native side assigned at bind time
   * @param {string} args.sessionId       — Hub-issued bundle session id (from registerBundle)
   * @param {number} args.version         — negotiated AIDL version
   */
  constructor({ nativeModule, bindingId, sessionId, version }) {
    if (!nativeModule || typeof nativeModule.callMethod !== 'function') {
      throw Object.assign(
        new Error('IHubBinding: nativeModule.callMethod is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    this.#nativeModule = nativeModule;
    this.#bindingId    = bindingId;
    this.#sessionId    = sessionId;
    this.#version      = version;
  }

  get version()    { return this.#version; }
  get bindingId()  { return this.#bindingId; }
  get sessionId()  { return this.#sessionId; }
  get isClosed()   { return this.#closed; }

  #assertOpen() {
    if (this.#closed) {
      throw Object.assign(
        new Error('IHubBinding: binding is closed'),
        { code: 'BINDING_CLOSED' },
      );
    }
  }

  /** Hub V2 introspection — refresh the Hub-declared capabilities. */
  async declareCapabilities(caps) {
    this.#assertOpen();
    return this.#nativeModule.callMethod(this.#bindingId, 'declareCapabilities', {
      bundleSessionId:   this.#sessionId,
      capabilitiesJson:  JSON.stringify(caps ?? {}),
    });
  }

  /** Fetch a resource via the Hub's pseudo-pod/pod-client. */
  async fetchResource(uri) {
    this.#assertOpen();
    if (typeof uri !== 'string' || uri.length === 0) {
      throw Object.assign(
        new Error('fetchResource: uri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return this.#nativeModule.callMethod(this.#bindingId, 'fetchResource', {
      bundleSessionId: this.#sessionId,
      uri,
    });
  }

  /** Write a resource via the Hub. Returns the assigned etag. */
  async writeResource(uri, bytes, etag) {
    this.#assertOpen();
    if (typeof uri !== 'string' || uri.length === 0) {
      throw Object.assign(
        new Error('writeResource: uri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return this.#nativeModule.callMethod(this.#bindingId, 'writeResource', {
      bundleSessionId: this.#sessionId,
      uri,
      bytes,
      etag: etag ?? '',
    });
  }

  /**
   * Publish a notify-envelope through the Hub's transport.
   *
   * @param {Envelope} envelope
   * @param {string[]} recipients
   */
  async publishEnvelope(envelope, recipients) {
    this.#assertOpen();
    if (!envelope || typeof envelope !== 'object') {
      throw Object.assign(
        new Error('publishEnvelope: envelope must be an object'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(
        new Error('publishEnvelope: recipients must be a non-empty array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return this.#nativeModule.callMethod(this.#bindingId, 'publishEnvelope', {
      bundleSessionId: this.#sessionId,
      envelopeJson:    JSON.stringify(envelope),
      recipientsCsv:   recipients.join(','),
    });
  }

  /**
   * Subscribe to inbound envelopes routed by the Hub. Returns an
   * unsubscribe fn.
   *
   * Standardisation Phase 51.9.1.
   */
  onIncomingEnvelope(callback) {
    this.#assertOpen();
    if (typeof callback !== 'function') {
      throw Object.assign(
        new Error('onIncomingEnvelope: callback is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    this.#envelopeSubscribers.add(callback);
    // Lazy-register the native callback on first subscribe.
    if (this.#nativeCallbackUnsub === null) {
      const unsub = this.#nativeModule.registerIncomingCallback(
        this.#bindingId,
        (raw) => this.#dispatchIncoming(raw),
      );
      this.#nativeCallbackUnsub = typeof unsub === 'function' ? unsub : null;
    }
    return () => {
      this.#envelopeSubscribers.delete(callback);
      // When the last subscriber leaves, drop the native registration.
      if (this.#envelopeSubscribers.size === 0 && typeof this.#nativeCallbackUnsub === 'function') {
        try { this.#nativeCallbackUnsub(); } catch { /* swallow */ }
        this.#nativeCallbackUnsub = null;
      }
    };
  }

  #dispatchIncoming(raw) {
    if (this.#closed) return;
    let envelope = raw;
    if (typeof raw === 'string') {
      try { envelope = JSON.parse(raw); } catch { /* keep raw */ }
    }
    for (const cb of this.#envelopeSubscribers) {
      try { cb(envelope); } catch { /* swallow */ }
    }
  }

  /**
   * V2-only — register a renderer with the central interface-registry.
   * Throws on V1 bindings.
   */
  async registerInterface(rendererManifest) {
    this.#assertOpen();
    this.#requireV2('registerInterface');
    return this.#nativeModule.callMethod(this.#bindingId, 'registerInterface', {
      bundleSessionId: this.#sessionId,
      rendererJson:    JSON.stringify(rendererManifest ?? {}),
    });
  }

  /** V2-only — lookup an active renderer by type. */
  async lookupInterface(typeName) {
    this.#assertOpen();
    this.#requireV2('lookupInterface');
    return this.#nativeModule.callMethod(this.#bindingId, 'lookupInterface', {
      bundleSessionId: this.#sessionId,
      typeName,
    });
  }

  /** V2-only — drive a protocol step through the central orchestrator. */
  async orchestrateProtocol(protocolId, eventArgs) {
    this.#assertOpen();
    this.#requireV2('orchestrateProtocol');
    return this.#nativeModule.callMethod(this.#bindingId, 'orchestrateProtocol', {
      bundleSessionId: this.#sessionId,
      protocolId,
      eventJson:       JSON.stringify(eventArgs ?? {}),
    });
  }

  #requireV2(method) {
    if (this.#version < 2) {
      throw Object.assign(
        new Error(`${method}: requires IHub V2+; negotiated version is ${this.#version}`),
        { code: 'VERSION_UNSUPPORTED', requiredVersion: 2, negotiatedVersion: this.#version },
      );
    }
  }

  /**
   * Unbind the service + free both native + JS resources. Idempotent.
   */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#envelopeSubscribers.clear();
    if (typeof this.#nativeCallbackUnsub === 'function') {
      try { this.#nativeCallbackUnsub(); } catch { /* swallow */ }
      this.#nativeCallbackUnsub = null;
    }
    if (typeof this.#nativeModule.unbindService === 'function') {
      try { await this.#nativeModule.unbindService(this.#bindingId); }
      catch { /* swallow — best-effort cleanup */ }
    }
  }
}
