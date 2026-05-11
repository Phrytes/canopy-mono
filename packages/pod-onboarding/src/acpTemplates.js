/**
 * Default Access Control Policy (ACP) templates the substrate
 * stamps onto a freshly-provisioned pod.
 *
 * Three canonical containers (functional design §4.2.3):
 *
 *   - `/private/`        — agent-locked. Only the owning agent's
 *                          WebID can read or write. Used for the
 *                          identity-vault, storage-mapping,
 *                          agent-registry, audit-log.
 *   - `/sharing/`        — default-deny per-resource. New resources
 *                          inherit "owner-write, no-read"; ACPs are
 *                          opened on a per-resource basis when the
 *                          owner shares.
 *   - `/sharing/public/` — world-readable, owner-write. Hosts the
 *                          profile card + anything explicitly public.
 *
 * The substrate ships these as **inert JSON-LD-shaped objects**.
 * Applying them to a pod is the provisioner's job (Solid-server-
 * specific Turtle / ACP-resource shape).
 *
 * See functional design §4.2.3.
 */

/** ACP vocabulary IRIs. */
export const ACP = Object.freeze({
  AccessControlResource: 'http://www.w3.org/ns/solid/acp#AccessControlResource',
  Policy:                'http://www.w3.org/ns/solid/acp#Policy',
  Matcher:               'http://www.w3.org/ns/solid/acp#Matcher',
  AccessGrant:           'http://www.w3.org/ns/solid/acp#AccessGrant',
  apply:                 'http://www.w3.org/ns/solid/acp#apply',
  allow:                 'http://www.w3.org/ns/solid/acp#allow',
  deny:                  'http://www.w3.org/ns/solid/acp#deny',
  agent:                 'http://www.w3.org/ns/solid/acp#agent',
  publicAgent:           'http://www.w3.org/ns/solid/acp#PublicAgent',
});

/** Standard access modes (`acl:` vocabulary kept for compatibility). */
export const MODES = Object.freeze({
  read:    'http://www.w3.org/ns/auth/acl#Read',
  write:   'http://www.w3.org/ns/auth/acl#Write',
  append:  'http://www.w3.org/ns/auth/acl#Append',
  control: 'http://www.w3.org/ns/auth/acl#Control',
});

/**
 * Build the ACP template for the `/private/` container.
 * Only `agentWebid` can read / write / append / control.
 */
export function privateAcp({ agentWebid }) {
  if (typeof agentWebid !== 'string' || agentWebid.length === 0) {
    throw Object.assign(
      new Error('privateAcp: agentWebid is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  return Object.freeze({
    template:    'private',
    description: 'Agent-locked. Only the owning agent has access.',
    policies: [{
      allow:    [MODES.read, MODES.write, MODES.append, MODES.control],
      matchers: [{ agent: agentWebid }],
    }],
  });
}

/**
 * Build the ACP template for `/sharing/` — default-deny.
 * Owner has full access; everyone else is denied by default.
 * Per-resource overrides happen when the owner explicitly shares.
 */
export function sharingAcp({ agentWebid }) {
  if (typeof agentWebid !== 'string' || agentWebid.length === 0) {
    throw Object.assign(
      new Error('sharingAcp: agentWebid is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  return Object.freeze({
    template:    'sharing',
    description: 'Default-deny. Owner full access; per-resource overrides when shared.',
    policies: [{
      allow:    [MODES.read, MODES.write, MODES.append, MODES.control],
      matchers: [{ agent: agentWebid }],
    }],
    // Default-deny is the absence of public matchers — no explicit deny needed.
  });
}

/**
 * Build the ACP template for `/sharing/public/` — world-readable,
 * owner-write.
 */
export function sharingPublicAcp({ agentWebid }) {
  if (typeof agentWebid !== 'string' || agentWebid.length === 0) {
    throw Object.assign(
      new Error('sharingPublicAcp: agentWebid is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  return Object.freeze({
    template:    'sharing-public',
    description: 'World-readable, owner-write.',
    policies: [
      {
        allow:    [MODES.read],
        matchers: [{ publicAgent: true }],
      },
      {
        allow:    [MODES.read, MODES.write, MODES.append, MODES.control],
        matchers: [{ agent: agentWebid }],
      },
    ],
  });
}

/**
 * Build all three default ACP templates in one call.
 *
 * @returns {{private: object, sharing: object, sharingPublic: object}}
 */
export function defaultAcpTemplates({ agentWebid }) {
  return {
    private:       privateAcp({ agentWebid }),
    sharing:       sharingAcp({ agentWebid }),
    sharingPublic: sharingPublicAcp({ agentWebid }),
  };
}
