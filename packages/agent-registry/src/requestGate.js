// Egress gate + zero-disclosure receipt — the enforceable "the answer travels, not the data"
// waist (design Phase 4; plans/NOTE-property-layer-design.md §2 receipt, §4 Tier 0/1 gate).
//
// This is the PURE gate logic ONLY. It computes, from a Request + the user's disclosure
// decision + the governed-request check, exactly what would leave the device and a truthful
// receipt of it. The actual interception of an external `{opId,args}` dispatch and the
// on-screen receipt/banner live in the canopy-chat shell — a LATER, separate step. Nothing
// here dispatches, transports, or renders; no app import.
//
// The gate combines two orthogonal decisions:
//   • DISCLOSURE (what the user chose to share) → `releasedValues(...)`, already coarse.
//   • GOVERNANCE (what the requester may even ASK here) → `checkRequestAllowed(...)`.
// A governed-forbidden ask is BLOCKED entirely — nothing leaves — even if the user tried to
// share, because the harm is the coerced ask itself (§5). The outbound payload is exactly the
// coarse released set, or {} when blocked.

import { requestKeys } from './request.js';
import { checkRequestAllowed } from './governedRequest.js';

const UNGOVERNED = Object.freeze({ allowed: true, forbidden: [], warn: [] });

/**
 * Compute a truthful, zero-disclosure receipt of what a Request would take from this device.
 * @param {object} a
 * @param {object} a.request                     a createRequest(...) record
 * @param {object} a.released                    output of releasedValues(...) — {key: coarseValue}
 * @param {string} [a.contextType]               a governed context TYPE (e.g. 'employment'); ungoverned when absent
 * @param {object} [a.policyTable]               a governed-policy table (defaults inside checkRequestAllowed)
 * @param {object} [a.vocabulary]                a createVocabulary(...) — resolves item types for the governed check
 * @returns {{ shared:string[], withheld:string[], nothingLeft:boolean,
 *            governed:{allowed:boolean, forbidden:string[], warn:string[]} }}
 */
export function egressReceipt({ request, released, contextType = null, policyTable, vocabulary = null } = {}) {
  const rel = released && typeof released === 'object' ? released : {};
  const asked = requestKeys(request);
  const shared = asked.filter((k) => Object.prototype.hasOwnProperty.call(rel, k));
  const withheld = asked.filter((k) => !Object.prototype.hasOwnProperty.call(rel, k));
  const governed = contextType
    ? checkRequestAllowed(request, contextType, policyTable, vocabulary)
    : { ...UNGOVERNED };
  return {
    shared,
    withheld,
    nothingLeft: shared.length === 0,   // the "🔒 nothing about you left this device" signal
    governed,
  };
}

/**
 * The enforceable egress gate: decide whether the outbound payload may leave, build it, and
 * attach the receipt. A governed-forbidden ask is BLOCKED (allow:false, payload:{}) even if
 * the user disclosed values. Otherwise the payload is exactly the coarse released set.
 * @param {object} a  same fields as egressReceipt(...)
 * @returns {{ allow:boolean, payload:object, receipt:object }}
 */
export function gateEgress({ request, released, contextType = null, policyTable, vocabulary = null } = {}) {
  const receipt = egressReceipt({ request, released, contextType, policyTable, vocabulary });
  const rel = released && typeof released === 'object' ? released : {};
  const allow = receipt.governed.allowed === true;
  // Nothing leaves on a blocked request — the coerced/forbidden ask gets an empty payload.
  const payload = allow ? { ...rel } : {};
  return { allow, payload, receipt };
}
