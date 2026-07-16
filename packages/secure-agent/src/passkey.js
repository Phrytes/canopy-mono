/**
 * @onderling/secure-agent — WebAuthn (passkey) helpers.
 *
 * Wires A+.5 from the v0.7 security roadmap.  Two operations:
 *
 *   - registerPasskey({rpId, rpName, userId, userName})
 *       Calls navigator.credentials.create() with the PRF extension
 *       to register a fresh resident credential.  Returns the new
 *       credentialId (caller stores it so unlock can target it).
 *
 *   - unlockWithPasskey({rpId, prfSalt, credentialId?})
 *       Calls navigator.credentials.get() with the PRF extension to
 *       derive a 32-byte deterministic secret from the registered
 *       passkey + a per-app `prfSalt`.  Returns the base64url-encoded
 *       secret, suitable to pass as `passphrase` to createSecureAgent.
 *
 * # Why PRF (CTAP2 `hmac-secret` extension)?
 *
 * PRF gives us a STABLE secret from a passkey: same authenticator +
 * same salt → same 32-byte output, every time.  That makes it usable
 * as a deterministic vault encryption key — the user "logs in with
 * their fingerprint" + the same key derives every time, without us
 * ever storing it.
 *
 * # Browser support
 *
 * PRF is supported on Chrome 116+, Edge 116+, Safari 17.4+ (macOS),
 * and a growing set of authenticators (Touch ID / Windows Hello /
 * YubiKey 5 series).  When unsupported, unlockWithPasskey throws
 * 'PASSKEY_PRF_UNAVAILABLE' so the app can fall back to a plain
 * passphrase prompt.
 *
 * Layer: substrate.  Browser-only (uses `navigator.credentials`).
 */

import { b64encode, b64decode } from '@onderling/core';

/**
 * Error codes (stable strings — apps can switch on these).
 */
export const PASSKEY_ERRORS = Object.freeze({
  NO_WEBAUTHN:           'PASSKEY_NO_WEBAUTHN',
  PRF_UNAVAILABLE:       'PASSKEY_PRF_UNAVAILABLE',
  REGISTRATION_REJECTED: 'PASSKEY_REGISTRATION_REJECTED',
  UNLOCK_REJECTED:       'PASSKEY_UNLOCK_REJECTED',
});

/**
 * Detect whether the runtime supports the WebAuthn API at all.
 * (PRF support is a separate runtime check that needs an actual
 * ceremony — we surface that as a throw in unlockWithPasskey.)
 */
export function webauthnAvailable() {
  return typeof globalThis.navigator !== 'undefined'
      && !!globalThis.navigator.credentials
      && typeof globalThis.navigator.credentials.create === 'function';
}

/**
 * Convenience: turn a UTF-8 string into a BufferSource (Uint8Array).
 * WebAuthn expects ArrayBuffer-like inputs everywhere.
 */
function utf8(s) {
  return new TextEncoder().encode(s);
}

/**
 * Register a passkey with the PRF extension declared so that
 * subsequent unlockWithPasskey() calls can derive a stable secret.
 *
 * Most CTAP2 authenticators that support PRF will return some signal
 * in the extension results acknowledging the registration; some
 * don't.  We don't fail registration if the ack is missing — the
 * unlock step will reveal real PRF availability.
 *
 * @param {object} args
 * @param {string} args.rpId       relying-party identifier (== window hostname for prod)
 * @param {string} [args.rpName]   display name for the RP (default = rpId)
 * @param {string|Uint8Array} args.userId       stable user handle (NOT the username)
 * @param {string} args.userName   the username shown in the OS UI
 * @param {string} [args.userDisplayName]       human-readable label
 * @param {Uint8Array} [args.challenge]         server-issued challenge; default = random 32B
 * @returns {Promise<{ credentialId: string, rawId: Uint8Array }>}
 */
export async function registerPasskey(args = {}) {
  if (!webauthnAvailable()) {
    const e = new Error('WebAuthn not available in this runtime');
    e.code = PASSKEY_ERRORS.NO_WEBAUTHN;
    throw e;
  }
  if (typeof args.rpId !== 'string' || !args.rpId) {
    throw new Error('registerPasskey: rpId required');
  }
  if (typeof args.userName !== 'string' || !args.userName) {
    throw new Error('registerPasskey: userName required');
  }

  const userIdBytes = args.userId instanceof Uint8Array
    ? args.userId
    : utf8(args.userId ?? args.userName);

  const challenge = args.challenge instanceof Uint8Array
    ? args.challenge
    : globalThis.crypto.getRandomValues(new Uint8Array(32));

  const publicKey = {
    challenge,
    rp:   { id: args.rpId, name: args.rpName ?? args.rpId },
    user: {
      id:          userIdBytes,
      name:        args.userName,
      displayName: args.userDisplayName ?? args.userName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7   },   // ES256
      { type: 'public-key', alg: -257 },   // RS256
    ],
    authenticatorSelection: {
      residentKey:        'required',      // discoverable credential
      userVerification:   'required',
    },
    extensions: {
      prf: {},                             // declare PRF for later use
    },
    timeout: 60_000,
  };

  let cred;
  try {
    cred = await globalThis.navigator.credentials.create({ publicKey });
  } catch (err) {
    const e = new Error(`Passkey registration rejected: ${err?.message ?? err}`);
    e.code = PASSKEY_ERRORS.REGISTRATION_REJECTED;
    e.cause = err;
    throw e;
  }

  const rawId = new Uint8Array(cred.rawId);
  return {
    credentialId: b64encode(rawId),
    rawId,
  };
}

/**
 * Unlock: request a PRF-derived secret from the registered passkey.
 * Returns the base64url-encoded secret bytes (32 bytes) — feed this
 * into `createSecureAgent({ passphrase: <result> })`.
 *
 * @param {object} args
 * @param {string} args.rpId             relying-party id (must match registration)
 * @param {string|Uint8Array} args.prfSalt   per-app salt (stable string; identical → identical secret)
 * @param {string} [args.credentialId]   base64url-encoded id from register; omit for
 *                                       allow-any (resident creds)
 * @param {Uint8Array} [args.challenge]  defaults to random 32B
 * @returns {Promise<string>}            base64url-encoded 32-byte secret
 */
export async function unlockWithPasskey(args = {}) {
  if (!webauthnAvailable()) {
    const e = new Error('WebAuthn not available in this runtime');
    e.code = PASSKEY_ERRORS.NO_WEBAUTHN;
    throw e;
  }
  if (typeof args.rpId !== 'string' || !args.rpId) {
    throw new Error('unlockWithPasskey: rpId required');
  }
  if (args.prfSalt == null) {
    throw new Error('unlockWithPasskey: prfSalt required (stable bytes/string per app)');
  }

  const saltBytes = args.prfSalt instanceof Uint8Array ? args.prfSalt : utf8(args.prfSalt);
  const challenge = args.challenge instanceof Uint8Array
    ? args.challenge
    : globalThis.crypto.getRandomValues(new Uint8Array(32));

  const publicKey = {
    challenge,
    rpId:        args.rpId,
    timeout:     60_000,
    userVerification: 'required',
    extensions:  { prf: { eval: { first: saltBytes } } },
  };
  if (args.credentialId) {
    publicKey.allowCredentials = [{
      id:   b64decode(args.credentialId),
      type: 'public-key',
    }];
  }

  let assertion;
  try {
    assertion = await globalThis.navigator.credentials.get({ publicKey });
  } catch (err) {
    const e = new Error(`Passkey unlock rejected: ${err?.message ?? err}`);
    e.code = PASSKEY_ERRORS.UNLOCK_REJECTED;
    e.cause = err;
    throw e;
  }

  const results = assertion.getClientExtensionResults?.() ?? {};
  const prfFirst = results?.prf?.results?.first;
  if (!prfFirst) {
    const e = new Error(
      'PRF unavailable — authenticator did not return a hmac-secret. ' +
      'Fall back to a passphrase prompt.',
    );
    e.code = PASSKEY_ERRORS.PRF_UNAVAILABLE;
    throw e;
  }
  return b64encode(new Uint8Array(prfFirst));
}
