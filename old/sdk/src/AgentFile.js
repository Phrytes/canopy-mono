/**
 * AgentFile — parse and validate YAML/JSON agent definition files.
 *
 * Works without a build step in the browser.
 *
 * YAML parsing requires js-yaml available as:
 *   - CDN global:    window.jsyaml     (https://unpkg.com/js-yaml/dist/js-yaml.min.js)
 *   - ES module:     import jsyaml from 'js-yaml'  — pass as option
 *   - Node CJS:      require('js-yaml') auto-detected via globalThis
 *
 * Usage:
 *   const def = AgentFile.parse(yamlString);
 *   const def = await AgentFile.load('./agents.yaml');
 *   const def = await AgentFile.load('./agents.yaml', { yamlLib: jsyaml });
 */
export class AgentFile {
  /**
   * Parse an agent definition from a string (YAML or JSON).
   * @param {string} text
   * @param {{ yamlLib? }} [options]
   */
  static parse(text, options = {}) {
    const raw = AgentFile.#parseText(text.trim(), options.yamlLib);
    return AgentFile.#normalise(raw);
  }

  /**
   * Load and parse an agent definition from a URL (browser) or file path (Node).
   * @param {string} urlOrPath
   * @param {{ yamlLib? }} [options]
   */
  static async load(urlOrPath, options = {}) {
    let text;
    if (typeof fetch !== 'undefined') {
      const res = await fetch(urlOrPath);
      if (!res.ok) throw new Error(`AgentFile.load: ${res.status} ${urlOrPath}`);
      text = await res.text();
    } else {
      const fs = await import('fs/promises');
      text = await fs.readFile(urlOrPath, 'utf8');
    }
    return AgentFile.parse(text, options);
  }

  /**
   * Serialise a definition back to YAML (or JSON if js-yaml is unavailable).
   * @param {object} def   — normalised definition
   * @param {{ yamlLib? }} [options]
   */
  static toYaml(def, options = {}) {
    const lib = options.yamlLib
      ?? globalThis.jsyaml
      ?? null;
    if (lib) return lib.dump(def);
    return JSON.stringify(def, null, 2);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  static #parseText(text, yamlLib) {
    if (text.startsWith('{') || text.startsWith('[')) {
      return JSON.parse(text);
    }
    const lib = yamlLib ?? globalThis.jsyaml ?? null;
    if (!lib) {
      throw new Error(
        'YAML parsing requires js-yaml. Load it from CDN or pass options.yamlLib.'
      );
    }
    return lib.load(text);
  }

  /**
   * Normalise raw parsed data into a canonical structure:
   *   { version, roles, agents }
   */
  static #normalise(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('AgentFile: invalid definition — must be an object');
    }

    const version = raw.version ?? 1;
    const roles   = raw.roles ?? [];

    // Single-agent shorthand: { agent: {...}, capabilities: [...], ... }
    if (raw.agent) {
      return { version, roles, agents: [raw] };
    }

    // Multi-agent: { agents: [...] }
    if (Array.isArray(raw.agents)) {
      return { version, roles, agents: raw.agents };
    }

    throw new Error('AgentFile: definition must have "agent" or "agents" key');
  }
}
