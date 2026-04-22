import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    // node-datachannel/polyfill (used by the rendezvous tests in AA2 and
    // the AB phases of mesh-scenario) holds shared native state; two
    // test files running concurrent WebRTC sessions race on ICE and
    // time out. Disable file-level parallelism for the whole package —
    // test runtime cost is ~1-2 s, worth the reliability.
    fileParallelism: false,
  },
});
