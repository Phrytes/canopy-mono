/**
 * seedOnboardingPod — repeatable seed-onboarding flow for a fresh
 * customer / household pod.
 *
 * This is the *composition* layer: it does NOT reinvent the resource
 * builders (`initialResources.js`) or the ACP templates
 * (`acpTemplates.js`) — it wires them together into one idempotent,
 * mock-testable sequence:
 *
 *   1. storage-mapping  → `<pod>/private/storage-mapping`
 *   2. agent-registry   → `<pod>/private/agent-registry`
 *   3. WebID pointers   → `<pod>/profile/card`   (patch or PUT)
 *   4. default ACP templates → `/private/`, `/sharing/`, `/sharing/public/`
 *
 * The pod I/O is INJECTED via a duck-typed `podClient` so the flow is
 * testable against a recording mock — no live CSS/Solid server. The
 * `podClient` contract (all optional except one writer):
 *
 *   - `put({ uri, body, contentType })`   ← preferred writer
 *   - `write(uri, body)`                  ← fallback writer
 *   - `setAcp({ uri, acp })`              ← applies an ACP template
 *   - `patchWebidProfile({ webidUri, pointers, predicates })`
 *                                          ← WebID patch (else the
 *                                            pointers are PUT as a resource)
 *   - `has(uri)` / `get(uri)`             ← existence probe → idempotency
 *
 * Idempotency: when the `podClient` can report existence (`has`/`get`),
 * an already-seeded resource / ACP is a no-op (`status: 'skipped'`).
 * When it can't, writes are plain PUT-upserts — still safe to repeat.
 *
 * A mid-way write failure throws a coded `SEED_WRITE_FAILED` error
 * (carrying `{ kind, uri, cause }`) so the caller can abort BEFORE it
 * records the instance in the customer register — no half-registered
 * instance.
 *
 * Live-pod writes, real customer billing/lifecycle, and deploy/ops
 * provisioning are OUT of scope (org roadmap §5) — this stays a
 * substrate; the `podClient` is the seam to the real server.
 */

import { defaultAcpTemplates } from './acpTemplates.js';
import {
  buildInitialStorageMapping,
  buildInitialAgentRegistry,
  buildWebidPointers,
  pointerPredicates,
} from './initialResources.js';

function _invalid(msg) {
  return Object.assign(new Error(msg), { code: 'INVALID_ARGUMENT' });
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function _exists(podClient, uri) {
  if (typeof podClient.has === 'function') return Boolean(await podClient.has(uri));
  if (typeof podClient.get === 'function') return (await podClient.get(uri)) != null;
  return null; // can't tell → caller should PUT-upsert
}

async function _writeResource(podClient, { uri, body, contentType, kind }) {
  try {
    if (typeof podClient.put === 'function') {
      await podClient.put({ uri, body, contentType });
      return;
    }
    if (typeof podClient.write === 'function') {
      await podClient.write(uri, body);
      return;
    }
    throw _invalid('seedOnboardingPod: podClient needs a `put` or `write` method');
  } catch (err) {
    if (err?.code === 'INVALID_ARGUMENT') throw err;
    throw Object.assign(
      new Error(`seedOnboardingPod: failed writing ${kind} at ${uri}`),
      { code: 'SEED_WRITE_FAILED', kind, uri, cause: err },
    );
  }
}

/**
 * @typedef {object} SeedResourceSummary
 * @property {string} uri
 * @property {string} kind          — 'storage-mapping' | 'agent-registry' | 'webid-profile' | 'acp:*'
 * @property {'written'|'skipped'} status
 *
 * @typedef {object} SeedOnboardingResult
 * @property {string} podUri
 * @property {string} agentWebid
 * @property {SeedResourceSummary[]} resources
 * @property {boolean} ok
 */

/**
 * Provision a fresh customer/household pod by writing the initial
 * resources + applying the default ACP templates.
 *
 * @param {object} opts
 * @param {object} opts.podClient   duck-typed pod I/O (see module doc). Injected.
 * @param {object} opts.agentInfo   `{ deviceId, agentUri, pubKey, webid?, ... }` — the
 *                                   seed agent record (shape per `buildInitialAgentRegistry`).
 * @param {string} opts.podUri      pod root the customer's storage lives under.
 * @param {string} opts.deviceId    provisioning device id (drives the storage-mapping).
 * @returns {Promise<SeedOnboardingResult>}
 */
export async function seedOnboardingPod({ podClient, agentInfo, podUri, deviceId } = {}) {
  if (!podClient || typeof podClient !== 'object') {
    throw _invalid('seedOnboardingPod: `podClient` is required');
  }
  if (typeof podClient.put !== 'function' && typeof podClient.write !== 'function') {
    throw _invalid('seedOnboardingPod: `podClient` needs a `put` or `write` method');
  }
  if (typeof podUri !== 'string' || podUri.length === 0) {
    throw _invalid('seedOnboardingPod: `podUri` is required');
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw _invalid('seedOnboardingPod: `deviceId` is required');
  }
  if (!agentInfo || typeof agentInfo !== 'object') {
    throw _invalid('seedOnboardingPod: `agentInfo` is required');
  }

  const base = _stripTrailingSlash(podUri);
  // Default agentInfo.deviceId to the provisioning deviceId so a caller
  // can pass it once.
  const seedAgent = { deviceId, ...agentInfo };
  const agentWebid = seedAgent.webid ?? `${base}/profile/card#me`;

  const resources = [];

  // Write a resource unless it already exists (idempotency).
  async function upsert({ uri, body, contentType, kind }) {
    const present = await _exists(podClient, uri);
    if (present === true) {
      resources.push({ uri, kind, status: 'skipped' });
      return;
    }
    await _writeResource(podClient, { uri, body, contentType, kind });
    resources.push({ uri, kind, status: 'written' });
  }

  // ── 1. storage-mapping ────────────────────────────────────
  const storageMapping = buildInitialStorageMapping({ podUri, deviceId });
  const storageMappingUri = `${base}/private/storage-mapping`;
  await upsert({
    uri: storageMappingUri,
    body: storageMapping,
    contentType: 'application/json',
    kind: 'storage-mapping',
  });

  // ── 2. agent-registry ─────────────────────────────────────
  const agentRegistry = buildInitialAgentRegistry({
    podUri,
    // Carry the WebID into the seed so a later agent-registry lookup(webid)
    // matches this seed entry without a re-register.
    agentInfo: { ...seedAgent, webid: agentWebid },
  });
  const agentRegistryUri = `${base}/private/agent-registry`;
  await upsert({
    uri: agentRegistryUri,
    body: agentRegistry,
    contentType: 'application/json',
    kind: 'agent-registry',
  });

  // ── 3. WebID pointers ─────────────────────────────────────
  const pointers = buildWebidPointers({ podUri });
  const predicates = pointerPredicates();
  const profileUri = `${base}/profile/card`;
  if (typeof podClient.patchWebidProfile === 'function') {
    const present = await _exists(podClient, profileUri);
    if (present === true) {
      resources.push({ uri: profileUri, kind: 'webid-profile', status: 'skipped' });
    } else {
      try {
        await podClient.patchWebidProfile({ webidUri: agentWebid, pointers, predicates });
      } catch (err) {
        throw Object.assign(
          new Error(`seedOnboardingPod: failed patching webid-profile at ${profileUri}`),
          { code: 'SEED_WRITE_FAILED', kind: 'webid-profile', uri: profileUri, cause: err },
        );
      }
      resources.push({ uri: profileUri, kind: 'webid-profile', status: 'written' });
    }
  } else {
    await upsert({
      uri: profileUri,
      body: { webid: agentWebid, pointers, predicates },
      contentType: 'application/json',
      kind: 'webid-profile',
    });
  }

  // ── 4. default ACP templates ──────────────────────────────
  const acps = defaultAcpTemplates({ agentWebid });
  const containers = [
    { uri: `${base}/private/`,        acp: acps.private,       kind: 'acp:private' },
    { uri: `${base}/sharing/`,        acp: acps.sharing,       kind: 'acp:sharing' },
    { uri: `${base}/sharing/public/`, acp: acps.sharingPublic, kind: 'acp:sharing-public' },
  ];
  if (typeof podClient.setAcp === 'function') {
    for (const c of containers) {
      const present = await _exists(podClient, c.uri);
      if (present === true) {
        resources.push({ uri: c.uri, kind: c.kind, status: 'skipped' });
        continue;
      }
      try {
        await podClient.setAcp({ uri: c.uri, acp: c.acp });
      } catch (err) {
        throw Object.assign(
          new Error(`seedOnboardingPod: failed applying ${c.kind} at ${c.uri}`),
          { code: 'SEED_WRITE_FAILED', kind: c.kind, uri: c.uri, cause: err },
        );
      }
      resources.push({ uri: c.uri, kind: c.kind, status: 'written' });
    }
  }

  return { podUri, agentWebid, resources, ok: true };
}
