/**
 * DataSourcePolicy — controls which skills/agents may access which data sources.
 *
 * Config shape (in AgentConfig or passed directly):
 *
 *   dataSources:
 *     notes:
 *       allowedSkills: ['note-read', 'note-write']   // omit → all skills allowed
 *       allowedAgents: ['pubKey1', 'pubKey2']         // omit → caller not checked
 *     private:
 *       allowedSkills: ['admin']
 *
 * If a source label is not listed in the policy, access is allowed by default.
 */

export class DataSourceAccessDeniedError extends Error {
  constructor(msg) {
    super(msg);
    this.name  = 'DataSourceAccessDeniedError';
    this.code  = 'ACCESS_DENIED';
  }
}

export class DataSourcePolicy {
  #rules;   // Map<label, { allowedSkills?: Set, allowedAgents?: Set }>

  /**
   * @param {object|null} config  — the dataSources section of AgentConfig, or null for open access
   */
  constructor(config = null) {
    this.#rules = new Map();
    if (!config) return;

    for (const [label, rule] of Object.entries(config)) {
      this.#rules.set(label, {
        allowedSkills: rule.allowedSkills ? new Set(rule.allowedSkills) : null,
        allowedAgents: rule.allowedAgents ? new Set(rule.allowedAgents) : null,
      });
    }
  }

  /**
   * Check whether access is permitted. Throws DataSourceAccessDeniedError if not.
   *
   * @param {object} opts
   * @param {string}      opts.sourceLabel
   * @param {string|null} [opts.skillId]   — skill requesting access
   * @param {string|null} [opts.agentId]   — caller's pubKey (for agent-level checks)
   */
  checkAccess({ sourceLabel, skillId = null, agentId = null }) {
    const rule = this.#rules.get(sourceLabel);
    if (!rule) return;  // label not configured → open access

    if (rule.allowedSkills && skillId && !rule.allowedSkills.has(skillId)) {
      throw new DataSourceAccessDeniedError(
        `Skill '${skillId}' is not allowed to access data source '${sourceLabel}'`,
      );
    }

    if (rule.allowedAgents && agentId && !rule.allowedAgents.has(agentId)) {
      throw new DataSourceAccessDeniedError(
        `Agent '${agentId.slice(0, 12)}…' is not allowed to access data source '${sourceLabel}'`,
      );
    }
  }
}
