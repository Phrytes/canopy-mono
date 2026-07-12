// Shared helpers for the e2e journey modules.
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny result collector: check(name, cond, detail) → pushes {name, ok, detail}. */
export function checker() {
  const results = [];
  return {
    results,
    check(name, cond, detail = '') {
      results.push({ name, ok: !!cond, detail });
      return !!cond;
    },
  };
}
