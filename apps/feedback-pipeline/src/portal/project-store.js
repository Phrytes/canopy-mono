// ProjectStore — the multi-tenant backbone of the portal (PR-2). One store holds every
// project's ProjectConfig plus its cohort (the amnesic code registry, reused as-is from
// src/activation/cohort.js). It is the single source the web GUI and the activation
// service both read, and it serialises to one JSON file so the package is easy to run.
//
// Key handling stays host-blind by default: only the project PUBLIC key is ever persisted
// here (in config.privacy.projectPublicKey). A host-generated private key is returned ONCE
// to the lead at creation and never written to disk — lose it and the data is unrecoverable,
// by design (plan R2). client/external keygen means the lead supplies the public key.

import crypto from 'node:crypto';
import { InMemoryCohortRegistry } from '../activation/cohort.js';
import { validateProjectConfig } from '../config/project-config.js';
import { IdentityRoster, makeContributionVerifier } from '../pod/signing.js';
import { InMemoryRoundControl, openVerificationRound } from '../verify/round-control.js';

export class ProjectStore {
  #configs = new Map();   // projectId -> { config, createdAt }
  #cohort;                // InMemoryCohortRegistry (shared with the activation service)
  #rosters = new Map();   // projectId -> IdentityRoster (pseudonym → signing pubKey)
  #rounds;                // InMemoryRoundControl — verify-summary verification rounds the lead opens

  constructor({ cohort, rounds } = {}) {
    this.#cohort = cohort || new InMemoryCohortRegistry();
    this.#rounds = rounds || new InMemoryRoundControl();
  }

  /** The shared verification-round control store — the participants' bots read open rounds from it
   *  (a project /control/ container in production; the same in-process store in the local demo). */
  roundControl() { return this.#rounds; }

  /** LEAD action — open a verification round for a project (verify-summary loop). Idempotent per round. */
  async openRound(projectId, round, { openedBy, message, deadline } = {}) {
    this.#req(projectId);
    return openVerificationRound({ controlStore: this.#rounds, projectId, round: Number(round), openedBy, message, deadline });
  }

  /** Open rounds for a project (most recent first). */
  async listRounds(projectId) {
    this.#req(projectId);
    return (await this.#rounds.listRounds(projectId)).slice().sort((a, b) => Number(b.round) - Number(a.round));
  }

  /** The shared cohort registry — so a co-located activation service redeems against the
   *  same state the portal issued codes from. */
  cohort() { return this.#cohort; }

  /** The project's identity roster (created on first use). Populated at activation by the
   *  signed HI registration; read by the aggregation verifier. */
  roster(projectId) {
    this.#req(projectId);
    if (!this.#rosters.has(projectId)) this.#rosters.set(projectId, new IdentityRoster());
    return this.#rosters.get(projectId);
  }

  /** Bind a verified identity (one code → one identity). Idempotent for the same key. The
   *  optional encryption key lets the central side seal two-way notifications to them. */
  bindIdentity(projectId, participant, pubKey, encPubKey) { return this.roster(projectId).bind(participant, pubKey, encPubKey); }

  /** The contribution verifier for a project's central pod, or null when the project does
   *  not require signatures (privacy.verify off → ACL-only trust). */
  verifierFor(projectId) {
    const config = this.getConfig(projectId);
    if (!config.privacy.verify) return null;
    return makeContributionVerifier({ roster: this.roster(projectId), projectId });
  }

  /** Create a project: validate its menukaart config, register a cohort (expiry + ceiling)
   *  with a fresh per-project signing secret. Returns the projectId. */
  createProject({ config, cohort, secret, inviteBase } = {}) {
    const c = validateProjectConfig(config);                 // throws on an invalid menukaart
    if (this.#configs.has(c.projectId)) throw new Error(`project already exists: ${c.projectId}`);
    if (!cohort?.expiresAt || !cohort?.ceiling) throw new Error('cohort { expiresAt, ceiling } is required');
    if (inviteBase) { try { new URL(inviteBase); } catch { throw new Error(`invalid inviteBase URL: ${inviteBase}`); } }
    const sec = secret || crypto.randomBytes(32).toString('hex');
    this.#cohort.registerProject({ projectId: c.projectId, expiresAt: cohort.expiresAt, ceiling: cohort.ceiling }, sec);
    this.#configs.set(c.projectId, { config: c, createdAt: new Date().toISOString(), inviteBase: inviteBase || undefined });
    return c.projectId;
  }

  /** Mint N single-use invite codes (the registry does NOT store them). */
  generateCodes(projectId, n) { this.#req(projectId); return this.#cohort.generateCodes(projectId, Number(n)); }

  /** A project's own invite-base URL, or undefined → the caller falls back to the portal
   *  default (FP_INVITE_BASE). Set per project so each cohort lands on its own surface. */
  inviteBaseFor(projectId) { return this.#req(projectId).inviteBase; }

  getConfig(projectId) { return this.#req(projectId).config; }

  /** Public status for the GUI dashboard — counts + the privacy posture, never secrets. */
  status(projectId) {
    const { config, createdAt, inviteBase } = this.#req(projectId);
    const spec = this.#cohort.getSpec(projectId);
    return {
      projectId, projectName: config.projectName, createdAt,
      activations: this.#cohort.activationCount(projectId), ceiling: spec.ceiling, expiresAt: spec.expiresAt,
      seal: config.privacy.seal, keygen: config.privacy.keygen,
      hasProjectKey: Boolean(config.privacy.projectPublicKey),
      inviteBase: inviteBase || null,
    };
  }

  listProjects() { return [...this.#configs.keys()].map((id) => this.status(id)); }

  toJSON() {
    return {
      configs: Object.fromEntries(this.#configs),
      cohort: this.#cohort.toJSON(),
      rosters: Object.fromEntries([...this.#rosters].map(([id, r]) => [id, r.toJSON()])),
      rounds: this.#rounds.toJSON(),
    };
  }

  static fromJSON(obj) {
    const store = new ProjectStore({
      cohort: InMemoryCohortRegistry.fromJSON(obj?.cohort),
      rounds: InMemoryRoundControl.fromJSON(obj?.rounds),
    });
    for (const [id, v] of Object.entries(obj?.configs || {})) store.#configs.set(id, v);
    for (const [id, r] of Object.entries(obj?.rosters || {})) store.#rosters.set(id, IdentityRoster.fromJSON(r));
    return store;
  }

  #req(id) { const v = this.#configs.get(id); if (!v) throw new Error(`unknown project: ${id}`); return v; }
}

/** Invite link a participant's app opens to activate: carries projectId + the single-use
 *  code. `base` is the activation endpoint (or the participant app) the lead hands out. */
export function inviteLink(base, projectId, code) {
  const u = new URL(base);
  u.searchParams.set('projectId', projectId);
  u.searchParams.set('code', code);
  return u.href;
}
