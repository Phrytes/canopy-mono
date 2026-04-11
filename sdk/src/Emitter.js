/** Tiny EventEmitter — works in browser and Node, no dependencies. */
export class Emitter {
  #h = {};
  on(e, fn)    { (this.#h[e] ??= []).push(fn); return this; }
  off(e, fn)   { this.#h[e] = (this.#h[e] ?? []).filter(h => h !== fn); }
  once(e, fn)  { const w = (...a) => { fn(...a); this.off(e, w); }; return this.on(e, w); }
  emit(e, ...a){ (this.#h[e] ?? []).slice().forEach(h => h(...a)); }
}
