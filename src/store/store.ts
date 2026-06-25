// Tiny reactive store — the single source of truth for the app.
// No framework: subscribe for changes, patch with set().

export type Listener<T> = (state: T) => void;

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
