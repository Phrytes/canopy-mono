/**
 * Reads and writes .agentnet.yaml definition files.
 *
 * File format (YAML):
 *
 *   version: "1.0"
 *
 *   agents:
 *     - id: db-guardian
 *       name: "Database Guardian"
 *       transport: nkn                    # transport type key
 *       address: "<nkn-address>"
 *       groups: [database-team]
 *       credentials:                      # encrypted with master key
 *         SOLID_POD_TOKEN: "<blob>"
 *
 *   groups:
 *     - id: database-team
 *       name: "Database Team"
 *       key_encrypted: "<blob>"           # group key encrypted with master key
 *
 *   connections:
 *     - from: my-app-agent                # app-side agent id
 *       to:   db-guardian                 # network agent id
 *       groups: [database-team]           # group keys the app agent presents
 */

import fs   from 'fs';
import yaml from 'js-yaml';
import { encrypt, decrypt } from './crypto.js';

export class DefinitionFile {
  constructor(filePath, masterKey) {
    this.filePath  = filePath;
    this.masterKey = masterKey;
    this._raw      = null;   // parsed YAML (credentials still encrypted)
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  load() {
    const content = fs.readFileSync(this.filePath, 'utf8');
    this._raw = yaml.load(content);
    return this;
  }

  // ── Agents ───────────────────────────────────────────────────────────────

  /** Returns agent definitions with credentials decrypted. */
  get agents() {
    return (this._raw.agents ?? []).map((a) => ({
      ...a,
      credentials: this._decryptMap(a.credentials ?? {}),
    }));
  }

  /** Returns a single agent by id (credentials decrypted). */
  getAgent(id) {
    return this.agents.find((a) => a.id === id) ?? null;
  }

  // ── Groups ───────────────────────────────────────────────────────────────

  /** Returns groups with their symmetric key decrypted. */
  get groups() {
    return (this._raw.groups ?? []).map((g) => ({
      ...g,
      key: g.key_encrypted ? decrypt(g.key_encrypted, this.masterKey) : null,
    }));
  }

  getGroup(id) {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  // ── Connections ──────────────────────────────────────────────────────────

  get connections() {
    return this._raw.connections ?? [];
  }

  /** Which network agents can a given app agent reach? */
  connectionsFrom(appAgentId) {
    return this.connections.filter((c) => c.from === appAgentId);
  }

  // ── Persistence helpers ──────────────────────────────────────────────────

  /**
   * Encrypt a plain credential map and add/update an agent entry.
   * Useful for a setup CLI / onboarding flow.
   */
  upsertAgent(agentDef, plaintextCredentials = {}) {
    if (!this._raw) this._raw = { version: '1.0', agents: [], groups: [], connections: [] };

    const encCreds = {};
    for (const [k, v] of Object.entries(plaintextCredentials)) {
      encCreds[k] = encrypt(v, this.masterKey);
    }

    const existing = (this._raw.agents ?? []).findIndex((a) => a.id === agentDef.id);
    const entry = { ...agentDef, credentials: encCreds };

    if (existing >= 0) {
      this._raw.agents[existing] = entry;
    } else {
      (this._raw.agents ??= []).push(entry);
    }
    return this;
  }

  /**
   * Create or update a group. The groupKey is stored encrypted.
   */
  upsertGroup(groupDef, plaintextGroupKey) {
    if (!this._raw) this._raw = { version: '1.0', agents: [], groups: [], connections: [] };

    const entry = {
      ...groupDef,
      key_encrypted: encrypt(plaintextGroupKey, this.masterKey),
    };
    delete entry.key;   // never persist plaintext key

    const existing = (this._raw.groups ?? []).findIndex((g) => g.id === groupDef.id);
    if (existing >= 0) {
      this._raw.groups[existing] = entry;
    } else {
      (this._raw.groups ??= []).push(entry);
    }
    return this;
  }

  save() {
    fs.writeFileSync(this.filePath, yaml.dump(this._raw, { lineWidth: 120 }), 'utf8');
    return this;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _decryptMap(encMap) {
    const out = {};
    for (const [k, blob] of Object.entries(encMap)) {
      try {
        out[k] = decrypt(blob, this.masterKey);
      } catch {
        out[k] = null;   // wrong key or tampered — surface as null
      }
    }
    return out;
  }
}
