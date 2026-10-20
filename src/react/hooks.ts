import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Engine, EngineEvents, EngineStats, Store } from '../engine'

export const EngineContext = createContext<Engine | null>(null)

export function useEngine(): Engine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine must be used inside <GameCanvas>')
  return engine
}

const identity = <T,>(value: T) => value

/**
 * Subscribes to a store. Re-renders only when the selected value changes,
 * so select primitives (or memoized objects), not fresh objects.
 */
export function useStore<T extends object>(store: Store<T>): T
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S = identity as (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}

export function useEngineStats(): EngineStats {
  return useStore(useEngine().stats)
}

/** Subscribes to an engine event for the component's lifetime. The handler may change freely. */
export function useEngineEvent<K extends keyof EngineEvents>(
  type: K,
  handler: (payload: EngineEvents[K]) => void,
): void {
  const engine = useEngine()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => engine.events.on(type, (payload) => ref.current(payload)), [engine, type])
}
