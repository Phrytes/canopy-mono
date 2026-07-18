/**
 * confirmDispatch — the MOBILE binding of the shared confirm gate
 * (web twin: circleApp's `openCircleConfirmDialog` + confirmDialog.js).
 *
 * Invariant #1: NO confirm/dispatch logic lives here — accept-exactly-
 * once / cancel-never-executes semantics come from shared
 * `apps/basis/src/v2/confirmGate.js` (consumed by both shells).
 * This module only binds the one mobile-specific choice: the presenter
 * is RN `Alert.alert` (the established destructive-confirm pattern —
 * see CircleLauncherScreen's leave-circle Alert), injected so the
 * launcher passes the real `Alert.alert` and tests pass a fake.
 *
 * Portable (zero RN imports) so the gate wiring is unit-testable in
 * vitest (which excludes src/screens entirely).
 */
import { runConfirmGate, confirmRequestFromRoute, readyFromConfirm }
  from '../../../basis/src/v2/confirmGate.js';

// Shared gate seam, re-exported so the RN shell imports ONE module for
// the whole confirm path (no second import site to drift).
export { runConfirmGate, confirmRequestFromRoute, readyFromConfirm };

/**
 * Wrap RN's `Alert.alert` as a confirm-gate presenter: resolves `true`
 * ONLY on the explicit accept tap; cancel tap, back-button dismiss
 * (`onDismiss`), and a double-firing Alert all resolve `false`/once.
 * Severity 'danger' → the accept button gets `style: 'destructive'`
 * (the platform's red confirm).
 *
 * @param {(title: string, message: string, buttons: object[], options?: object) => void} alert
 *        RN `Alert.alert` (injected; tests pass a fake)
 * @returns {(request: import('../../../basis/src/v2/confirmGate.js').ConfirmRequest) => Promise<boolean>}
 */
export function alertConfirmPresenter(alert) {
  if (typeof alert !== 'function') throw new TypeError('alertConfirmPresenter: alert function required');
  return (request) => new Promise((resolve) => {
    let settled = false;
    const settle = (accepted) => { if (!settled) { settled = true; resolve(accepted); } };
    alert(
      request?.title ?? '',
      request?.message ?? '',
      [
        { text: request?.cancelLabel ?? '', style: 'cancel', onPress: () => settle(false) },
        {
          text: request?.acceptLabel ?? '',
          style: request?.severity === 'danger' ? 'destructive' : 'default',
          onPress: () => settle(true),
        },
      ],
      // Android back / outside tap dismisses ⇒ cancel, never accept.
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}
