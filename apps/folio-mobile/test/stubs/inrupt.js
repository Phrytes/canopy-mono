/**
 * Empty stub for @inrupt/solid-client / @inrupt/solid-client-authn-node.
 *
 * The SDK core's SolidPodSource imports `@inrupt/solid-client`, but the
 * folio-mobile vitest path never reaches it — we just need the import
 * to resolve.  Production RN runtime is shielded by metro.config.js
 * (which redirects these to a node-builtins shim).
 */
export const getSolidDataset      = () => null;
export const getThing             = () => null;
export const getStringNoLocale    = () => null;
export const setStringNoLocale    = (t) => t;
export const saveSolidDatasetAt   = async () => null;
export const overwriteFile        = async () => null;
export const getFile              = async () => null;
export const deleteFile           = async () => null;
export const deleteSolidDataset   = async () => null;
export const createContainerAt    = async () => null;
export const createSolidDataset   = () => null;
export const setThing             = (d) => d;
export const buildThing           = () => ({ build: () => null });
export const createThing          = () => null;
export const getSourceUrl         = () => '';
export const isContainer          = () => false;
export const getContainedResourceUrlAll = () => [];
export const universalAccess      = {};
export const acp_v4               = {};

export class Session {
  async login()                 {}
  async logout()                {}
  async handleIncomingRedirect() {}
  get info() { return { isLoggedIn: false }; }
  fetch = async () => new Response('', { status: 200 });
  events = { on: () => {}, off: () => {} };
}

export default {};
