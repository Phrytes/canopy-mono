/**
 * Test stub for the optional `mqtt` package. @onderling/core's barrel eagerly re-exports MqttTransport, whose
 * `await import('mqtt')` vite's import-analysis tries to pre-resolve — so any suite that transitively loads
 * @onderling/core fails to LOAD when mqtt isn't installed (it's an optional runtime transport). Aliased here so
 * the suite loads; no test exercises a real MQTT connection. (Same pattern as the async-storage stub.)
 */
export default {
  connect() { throw new Error('mqtt stub (test) — real MQTT connect is not available under vitest'); },
};
