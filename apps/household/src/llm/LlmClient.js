/**
 * LlmClient — re-exported from @onderling/llm-client (L1j substrate).
 *
 * This file used to host the implementation; as of 2026-05-02 (Plan B
 * sub-task B.2) it's a thin re-export so the substrate owns the
 * canonical version.  Existing import sites
 * (`from '../llm/LlmClient.js'`, `from '../../src/llm/LlmClient.js'`)
 * continue to work unchanged.
 *
 * The substrate's LlmClient is a verbatim port of this file with
 * multi-tool-call support added.  See packages/llm-client/README.md.
 */

export { LlmClient } from '@onderling/llm-client';
