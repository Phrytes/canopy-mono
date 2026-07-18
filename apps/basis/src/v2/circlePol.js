/**
 * basis v2 — circle Proof-of-Location placeholder.
 *
 * Surfaces a passive "Proof of location" row on every circle's detail
 * screen. This slice ships the SEAM ONLY: a `getPolStatus` skill probe
 * that nobody registers yet (resolver returns null → empty state) and a
 * tiny formatter for the row text. The real attestation gate (presence-v0
 * HomeAgent + ProverAgent wiring with board-10C logic) is explicitly
 * deferred — see the PLAN "Later / excluded" section.
 *
 * 5.9d — placeholder; real attestation in [[5.9d-followup]].
 *
 * Wiring contract: hosts pass a 2-arg resolving `callSkill(opId, args)`
 * (the shared `makeResolvingCallSkill` shape). When `getPolStatus` is
 * unregistered the resolver throws (or returns null); either way we fall
 * through to `{ configured: false }`. By design this means the row stays
 * "Not configured" until a future slice wires a real reader on top.
 *
 * The status shape:
 *   { configured: false }                            — empty / not wired
 *   { configured: true, attestedAt, location }        — populated reader
 *
 * `attestedAt` is an epoch-ms number (or null); `location` is an
 * opaque human-readable string ("Selwerd hub", "kitchen-tag-7", …).
 */

/**
 * Probe `getPolStatus` for a circle. Tolerant: any throw or non-positive
 * response collapses to `{ configured: false }` so the renderer always
 * has a stable shape.
 *
 * @param {object}   opts
 * @param {function} [opts.callSkill] resolving callSkill (opId, args) → Promise
 * @param {string}   opts.circleId    the active circle id
 * @returns {Promise<{ configured: boolean, attestedAt?: ?number, location?: ?string }>}
 */
export async function getCirclePolStatus({ callSkill, circleId } = {}) {
  if (typeof callSkill !== 'function') return { configured: false };
  try {
    const r = await callSkill('getPolStatus', { circleId });
    if (r && r.configured === true) {
      return {
        configured: true,
        attestedAt: typeof r.attestedAt === 'number' ? r.attestedAt : null,
        location:   typeof r.location   === 'string' ? r.location   : null,
      };
    }
  } catch {
    /* op not registered yet (resolver throws) → empty */
  }
  return { configured: false };
}

/**
 * Format a PoL status for rendering. The empty case yields the
 * "Not configured" label; the populated case yields a localised
 * "Verified at {time}" string, optionally prefixed with the location.
 *
 * @param {{configured:boolean,attestedAt?:?number,location?:?string}} status
 * @param {function} tFn  the host's `t()` translator
 * @returns {string}
 */
export function formatPolStatus(status, tFn) {
  const t = typeof tFn === 'function' ? tFn : (k) => k;
  if (!status || status.configured !== true) {
    return t('circle.pol.notConfigured');
  }
  const time = formatAttestedAt(status.attestedAt);
  const line = t('circle.pol.attestedAt', { time });
  return status.location ? `${status.location} • ${line}` : line;
}

/**
 * Format an attested-at epoch into a short locale-stable string.
 * Falls back to '—' for missing / non-numeric input. Internal — exposed
 * for tests via the named export below.
 *
 * @internal
 */
export function formatAttestedAt(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
  try {
    return new Date(at).toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return '—';
  }
}
