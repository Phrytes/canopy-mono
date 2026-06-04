// Cohort activation codes (build proposal §1.2 / architecture §1.2) — the net-new,
// feedback-specific piece on top of the canopy substrate.
//
// A cohort = N single-use activation codes for one project, with an expiry and a
// ceiling. Codes are HMAC-signed with a per-project secret, so the service can
// validate a code WITHOUT storing the issued set — it is AMNESIC: it keeps only the
// SPENT code hashes, the activation count, and the recovery-hash ↔ pod-ref records
// (NO names, email, or identity).
//
// Server-side (the activation service runs on the VPS), so node:crypto is fine here —
// this is not the browser-side floor library.

import crypto from 'node:crypto';
import { z } from 'zod';

export const CohortSpecSchema = z.object({
  projectId: z.string().min(1),
  expiresAt: z.string(),               // ISO 8601; codes invalid at/after this
  ceiling: z.number().int().min(1),    // max successful activations
}).strict();

const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** A single-use code, HMAC-signed. Format: `<nonce>-<sig>`. */
export function makeCode(projectId, secret) {
  const nonce = crypto.randomBytes(8).toString('hex');                 // 16 hex chars
  return `${nonce}-${hmac(secret, `${projectId}:${nonce}`).slice(0, 12)}`;
}

/** Verify a code's signature (membership proof) without any stored issued set. */
export function codeSignatureValid(projectId, code, secret) {
  const [nonce, sig] = String(code).split('-');
  if (!nonce || !sig) return false;
  const expect = hmac(secret, `${projectId}:${nonce}`).slice(0, 12);
  return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}

/** In-memory cohort registry (the amnesic activation state). A real deployment holds
 *  the secret in a secret store and the spent/records in the project's activation pod. */
export class InMemoryCohortRegistry {
  #projects = new Map();   // projectId -> { spec, secret, spent:Set<hash>, count, records:[] }

  registerProject(spec, secret) {
    const s = CohortSpecSchema.parse(spec);
    if (!secret) throw new Error('a signing secret is required');
    this.#projects.set(s.projectId, { spec: s, secret, spent: new Set(), count: 0, records: [] });
    return s.projectId;
  }

  /** Generate N codes for the afnemer to distribute. The service does NOT store them. */
  generateCodes(projectId, n) {
    const p = this.#req(projectId);
    return Array.from({ length: n }, () => makeCode(projectId, p.secret));
  }

  /** @returns {{ok:true} | {ok:false, reason:string}} */
  validate(projectId, code, nowIso) {
    const p = this.#projects.get(projectId);
    if (!p) return { ok: false, reason: 'unknown project' };
    if (!codeSignatureValid(projectId, code, p.secret)) return { ok: false, reason: 'invalid code' };
    if (p.spent.has(sha256(code))) return { ok: false, reason: 'code already used' };
    if (nowIso >= p.spec.expiresAt) return { ok: false, reason: 'cohort expired' };
    if (p.count >= p.spec.ceiling) return { ok: false, reason: 'cohort full' };
    return { ok: true };
  }

  /** Redeem a code (single use) and store the AMNESIC activation record. Throws if invalid. */
  redeem(projectId, code, nowIso, { recoveryHash, podRef }) {
    const v = this.validate(projectId, code, nowIso);
    if (!v.ok) throw new Error(`activation refused: ${v.reason}`);
    if (!recoveryHash || !podRef) throw new Error('recoveryHash and podRef are required');
    const p = this.#projects.get(projectId);
    p.spent.add(sha256(code));
    p.count += 1;
    const record = { recoveryHash, podRef };     // NO identity
    p.records.push(record);
    return record;
  }

  /** Claim flow: present the recovery preimage → hash match → return the pod ref. */
  claimByRecovery(projectId, recoverySecret) {
    const p = this.#req(projectId);
    const h = sha256(recoverySecret);
    return p.records.find((r) => r.recoveryHash === h) || null;
  }

  activationCount(projectId) { return this.#req(projectId).count; }
  getSpec(projectId) { return this.#req(projectId).spec; }
  projectIds() { return [...this.#projects.keys()]; }

  /** Serialise registry state (Sets → arrays) for a file-backed store. NOTE: the
   *  signing secret is included for dev convenience; in production it lives in a
   *  secret store, separate from the spent/records data. */
  toJSON() {
    const out = {};
    for (const [pid, p] of this.#projects) {
      out[pid] = { spec: p.spec, secret: p.secret, spent: [...p.spent], count: p.count, records: p.records };
    }
    return out;
  }

  static fromJSON(obj) {
    const reg = new InMemoryCohortRegistry();
    for (const [pid, p] of Object.entries(obj || {})) {
      reg.#projects.set(pid, { spec: p.spec, secret: p.secret, spent: new Set(p.spent || []), count: p.count || 0, records: p.records || [] });
    }
    return reg;
  }

  #req(projectId) {
    const p = this.#projects.get(projectId);
    if (!p) throw new Error(`unknown project: ${projectId}`);
    return p;
  }
}

/** Hash a participant's recovery secret (only the hash reaches the service). */
export const recoveryHashOf = sha256;
