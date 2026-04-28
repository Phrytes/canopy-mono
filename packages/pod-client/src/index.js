/**
 * @canopy/pod-client — public API.
 *
 * Scaffolded by A5a.  A5b1 will add `CapabilityAuth` + `SolidOidcAuth`
 * concretes; A5b2 will add `PodClient`.  Until those land, this package
 * exposes only the error taxonomy and the `Auth` interface.
 */

export {
  PodClientError,
  AuthError,
  CapabilityError,
  NotFoundError,
  ConflictError,
  NetworkError,
  PolicyError,
  MalformedResourceError,
  EncryptionError,
  ConventionError,
  mapSourceCode,
} from './Errors.js';

export { Auth } from './Auth/Auth.js';
export { CapabilityAuth } from './Auth/CapabilityAuth.js';

// SolidOidcAuth (A5b1) + PodClient (A5b2) added next.
