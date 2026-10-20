export type Listener = () => void

/**
 * Tiny observable state container. This is the bridge between game code
 * (which writes) and UI (which subscribes), so React never re-renders per
 * frame unless a value it selected actually changed.
 */
export interface Store<T extends object> {
  get(): T
  /** Shallow-merges a patch. Listeners fire only if a field changed. */
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(listener: Listener): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<Listener>()

  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      let changed = false
      for (const key in next) {
        if (!Object.is(state[key], next[key])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
