/**
 * Tiny EventEmitter — no dependencies.
 * Works in browser, Node.js, and React Native.
 */
export class Emitter {
  #h = {};

  on(event, fn) {
    (this.#h[event] ??= []).push(fn);
    return this;
  }

  off(event, fn) {
    this.#h[event] = (this.#h[event] ?? []).filter(h => h !== fn);
    return this;
  }

  once(event, fn) {
    const wrapper = (...args) => { fn(...args); this.off(event, wrapper); };
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    (this.#h[event] ?? []).slice().forEach(h => h(...args));
  }

  removeAllListeners(event) {
    if (event) delete this.#h[event];
    else       this.#h = {};
    return this;
  }
}
