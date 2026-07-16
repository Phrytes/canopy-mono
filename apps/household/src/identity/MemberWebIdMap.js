/**
 * MemberWebIdMap — read-only lookup helper over a `HouseholdConfig`.
 *
 * TODO (2026-05-04, Phase 4.1 of substrate refactor): when we return to
 * H2 for V0 ship, replace this in-app helper with a thin wrapper over
 * `MemberMap.fromPodConfig({podClient, configUri})` from
 * `@onderling/identity-resolver`. The substrate factory now reads pod
 * config + populates a webid-keyed roster — the same pattern this
 * helper implements over `HouseholdConfig`. The H2 schema stays
 * (`HouseholdConfig.members[]`); only the read path moves to the
 * substrate. See `Project Files/Substrates/refactor/01-Execution-Checklist.md`
 * § Phase 4.1 + the "Migration policy for existing apps" section in
 * `Project Files/conventions/app-readme-scheme.md`.
 *
 * Three jobs, one tiny class:
 *
 *   1. `resolve(bridgeId, bridgeUid)` — `('telegram', '1234567')` →
 *      the member's webid.  The agent calls this on every incoming
 *      message to fill in `Sender.webid`, so cross-bridge identity
 *      collapses to a single webid for downstream skills.
 *
 *   2. `bindingFor(webid, bridgeId)` — reverse lookup: given a webid
 *      + bridge, return that member's binding (`bridgeUid`, optional
 *      `handle`).  Useful for "DM the author about this errand" — the
 *      orchestrator has the webid but the bridge needs the bridgeUid.
 *
 *   3. `member(webid)` — given a webid, return that member's full
 *      `MemberConfig` (role, podRoot, displayName, …).  Convenient for
 *      skills that want to know "is this person an admin?" or "where
 *      is this member's pod?".
 *
 * The map is **fully derived** from the `HouseholdConfig` it was
 * constructed with.  The config is passed by reference but the helper
 * only ever reads it; mutating the underlying members array after
 * construction is supported but undocumented (caller's call).
 *
 * Empty / missing fields are tolerated — a member with no `bridges`
 * map (the bot, a member who hasn't linked Telegram yet) simply
 * doesn't show up in `resolve` lookups.
 *
 * @see apps/household/src/types.js — `HouseholdConfig`,
 *      `MemberConfig`, `BridgeBinding`.
 * @see Project Files/coding-plans/track-H-app-household.md § "Pod
 *      schema → Per-member pod"
 */

/**
 * @typedef {import('../types.js').HouseholdConfig} HouseholdConfig
 * @typedef {import('../types.js').MemberConfig}    MemberConfig
 * @typedef {import('../types.js').BridgeBinding}   BridgeBinding
 */

export class MemberWebIdMap {
  /** @type {HouseholdConfig} */
  #config;

  /**
   * @param {HouseholdConfig} householdConfig
   */
  constructor(householdConfig) {
    if (!householdConfig || typeof householdConfig !== 'object') {
      throw new Error('MemberWebIdMap: householdConfig is required');
    }
    this.#config = householdConfig;
  }

  /** The wrapped config (read-only access for callers that need it). */
  get config() { return this.#config; }

  /**
   * The members array, defensively normalised to `[]` if absent.
   * @returns {Array<MemberConfig>}
   */
  #members() {
    const m = this.#config?.members;
    return Array.isArray(m) ? m : [];
  }

  /**
   * Resolve a (bridgeId, bridgeUid) pair to a member's webid.
   *
   * @param {string} bridgeId   e.g. 'telegram'
   * @param {string} bridgeUid  e.g. '1234567'
   * @returns {string|null}
   */
  resolve(bridgeId, bridgeUid) {
    if (!bridgeId || bridgeUid == null) return null;
    const uid = String(bridgeUid);
    for (const member of this.#members()) {
      const binding = member?.bridges?.[bridgeId];
      if (!binding) continue;
      if (String(binding.bridgeUid) === uid) {
        return member.webid ?? null;
      }
    }
    return null;
  }

  /**
   * Reverse lookup: given a webid + bridge, return that member's
   * binding for that bridge.  Returns `null` if the member isn't
   * bound on that bridge (or isn't in the household at all).
   *
   * @param {string} webid
   * @param {string} bridgeId
   * @returns {BridgeBinding|null}
   */
  bindingFor(webid, bridgeId) {
    if (!webid || !bridgeId) return null;
    const member = this.member(webid);
    if (!member) return null;
    const binding = member.bridges?.[bridgeId];
    return binding ?? null;
  }

  /**
   * Convenience: given a webid, return that member's `MemberConfig`.
   *
   * @param {string} webid
   * @returns {MemberConfig|null}
   */
  member(webid) {
    if (!webid) return null;
    for (const member of this.#members()) {
      if (member?.webid === webid) return member;
    }
    return null;
  }
}

export default MemberWebIdMap;
