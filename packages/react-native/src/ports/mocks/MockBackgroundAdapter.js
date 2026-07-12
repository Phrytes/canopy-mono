/**
 * MockBackgroundAdapter — device-free {@link BackgroundAdapter} for tests.
 *
 * Records the cold-start handler + reconnect schedules and lets a test drive
 * wake / app-state events.  Crucially it records the ORDER of calls so a test
 * can assert `defineColdStartTask` ran before engine boot (the `bgRunOnce`
 * constraint the real adapter preserves).
 */
import { BackgroundAdapter } from '../BackgroundAdapter.js';

export class MockBackgroundAdapter extends BackgroundAdapter {
  constructor() {
    super();
    this.coldStartHandler = null;
    this.reconnectSchedules = [];
    this.wakeHandlers = new Set();
    this.appStateHandlers = new Set();
    this.calls = [];              // ordered method log
    this.tornDown = false;
  }

  defineColdStartTask(handler) {
    this.calls.push('defineColdStartTask');
    this.coldStartHandler = handler;
  }

  async scheduleReconnect(opts) {
    this.calls.push('scheduleReconnect');
    this.reconnectSchedules.push(opts ?? {});
    return { scheduled: true };
  }

  onWake(handler) {
    this.calls.push('onWake');
    this.wakeHandlers.add(handler);
    return () => { this.wakeHandlers.delete(handler); };
  }

  onAppStateChange(handler) {
    this.calls.push('onAppStateChange');
    this.appStateHandlers.add(handler);
    return () => { this.appStateHandlers.delete(handler); };
  }

  async teardown() {
    this.calls.push('teardown');
    this.wakeHandlers.clear();
    this.appStateHandlers.clear();
    this.tornDown = true;
  }

  /** Test helper — simulate an OS wake. */
  _wake() { for (const h of this.wakeHandlers) h(); }

  /** Test helper — simulate a foreground/background transition. */
  _appState(state) { for (const h of this.appStateHandlers) h(state); }
}
