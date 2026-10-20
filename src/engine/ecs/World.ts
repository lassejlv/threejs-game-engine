import type { AnyComponent, ComponentType, Entity } from './component'
import { Query } from './Query'
import { SparseSet } from './SparseSet'

export type ComponentHook<T> = (entity: Entity, value: T) => void

export interface QueryDescriptor {
  all: readonly AnyComponent[]
  none?: readonly AnyComponent[]
}

/**
 * Entity/component storage. Pure data: no rendering, no scheduling.
 *
 * - Components are stored per type in sparse sets (fast add/remove/lookup).
 * - Queries are cached and updated incrementally.
 * - `destroy` is deferred until `flush()` so systems can destroy freely
 *   while iterating. Component add/remove is immediate.
 */
export class World {
  private nextId = 0
  private readonly freeIds: Entity[] = []
  private readonly alive = new SparseSet<true>()
  private readonly pendingDestroy = new Set<Entity>()
  private readonly stores: SparseSet<unknown>[] = []
  private readonly queries = new Map<string, Query>()
  private readonly queriesByComponent: Query[][] = []
  private readonly addHooks: ComponentHook<unknown>[][] = []
  private readonly removeHooks: ComponentHook<unknown>[][] = []

  get entityCount(): number {
    return this.alive.size
  }

  /** All live entities. Read-only. */
  get entities(): readonly Entity[] {
    return this.alive.dense
  }

  create(): Entity {
    const entity = this.freeIds.pop() ?? this.nextId++
    this.alive.set(entity, true)
    return entity
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity) && !this.pendingDestroy.has(entity)
  }

  /** Marks an entity for removal at the next `flush()`. */
  destroy(entity: Entity): void {
    if (this.alive.has(entity)) this.pendingDestroy.add(entity)
  }

  add<T>(entity: Entity, type: ComponentType<T>, value: T): T
  add(entity: Entity, type: ComponentType<true>): true
  add<T>(entity: Entity, type: ComponentType<T>, value: T = true as T): T {
    const store = this.store(type)
    const previous = store.get(entity)
    if (previous !== undefined) {
      if (previous === value) return value
      this.runHooks(this.removeHooks[type.id], entity, previous)
    }
    store.set(entity, value)
    this.runHooks(this.addHooks[type.id], entity, value)
    if (previous === undefined) this.syncQueries(entity, type)
    return value
  }

  remove(entity: Entity, type: AnyComponent): boolean {
    const store = this.stores[type.id]
    if (!store) return false
    const value = store.get(entity)
    if (value === undefined) return false
    store.delete(entity)
    this.runHooks(this.removeHooks[type.id], entity, value)
    this.syncQueries(entity, type)
    return true
  }

  has(entity: Entity, type: AnyComponent): boolean {
    return this.stores[type.id]?.has(entity) ?? false
  }

  /**
   * Returns the component value. Assumes the entity has it (e.g. inside a
   * query over that component); use `tryGet` when unsure.
   */
  get<T>(entity: Entity, type: ComponentType<T>): T {
    return this.store(type).get(entity) as T
  }

  tryGet<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.stores[type.id]?.get(entity) as T | undefined
  }

  /** Raw storage for a component type. Iterate `.values` for hot loops. */
  store<T>(type: ComponentType<T>): SparseSet<T> {
    let store = this.stores[type.id]
    if (!store) {
      store = new SparseSet<unknown>()
      this.stores[type.id] = store
    }
    return store as SparseSet<T>
  }

  query(...all: AnyComponent[]): Query
  query(descriptor: QueryDescriptor): Query
  query(...args: [QueryDescriptor] | AnyComponent[]): Query {
    const descriptor: QueryDescriptor =
      args.length === 1 && 'all' in args[0] ? args[0] : { all: args as AnyComponent[] }
    const all = descriptor.all
    const none = descriptor.none ?? []
    const key = `${ids(all)}|${ids(none)}`
    let query = this.queries.get(key)
    if (query) return query

    query = new Query(all, none)
    this.queries.set(key, query)
    for (const type of [...all, ...none]) {
      ;(this.queriesByComponent[type.id] ??= []).push(query)
    }
    // Seed from the smallest required store.
    const seed = all.length
      ? all.map((t) => this.store(t)).reduce((a, b) => (a.size <= b.size ? a : b)).dense
      : this.alive.dense
    for (const entity of seed) {
      if (this.matches(entity, query)) query._sync(entity, true)
    }
    return query
  }

  /** Called when a component of this type is added (or replaced). */
  onAdd<T>(type: ComponentType<T>, hook: ComponentHook<T>): () => void {
    return addHook(this.addHooks, type, hook)
  }

  /** Called when a component of this type is removed (or replaced). */
  onRemove<T>(type: ComponentType<T>, hook: ComponentHook<T>): () => void {
    return addHook(this.removeHooks, type, hook)
  }

  /** Applies deferred destroys. */
  flush(): void {
    if (this.pendingDestroy.size === 0) return
    for (const entity of this.pendingDestroy) {
      for (let id = 0; id < this.stores.length; id++) {
        const store = this.stores[id]
        if (!store?.has(entity)) continue
        const value = store.get(entity)
        store.delete(entity)
        this.runHooks(this.removeHooks[id], entity, value)
        const queries = this.queriesByComponent[id]
        if (queries) for (const q of queries) q._sync(entity, false)
      }
      this.alive.delete(entity)
      this.freeIds.push(entity)
    }
    this.pendingDestroy.clear()
  }

  /** Destroys every entity immediately (remove hooks still fire). Queries stay cached. */
  clear(): void {
    for (const entity of this.alive.dense) this.pendingDestroy.add(entity)
    this.flush()
    this.freeIds.length = 0
    this.nextId = 0
  }

  private matches(entity: Entity, query: Query): boolean {
    for (const type of query.all) if (!this.has(entity, type)) return false
    for (const type of query.none) if (this.has(entity, type)) return false
    return true
  }

  private syncQueries(entity: Entity, type: AnyComponent): void {
    const queries = this.queriesByComponent[type.id]
    if (!queries) return
    for (const query of queries) query._sync(entity, this.matches(entity, query))
  }

  private runHooks(hooks: ComponentHook<unknown>[] | undefined, entity: Entity, value: unknown): void {
    if (hooks) for (const hook of hooks) hook(entity, value)
  }
}

function ids(types: readonly AnyComponent[]): string {
  return types
    .map((t) => t.id)
    .sort((a, b) => a - b)
    .join(',')
}

function addHook<T>(
  table: ComponentHook<unknown>[][],
  type: ComponentType<T>,
  hook: ComponentHook<T>,
): () => void {
  const hooks = (table[type.id] ??= [])
  hooks.push(hook as ComponentHook<unknown>)
  return () => {
    const index = hooks.indexOf(hook as ComponentHook<unknown>)
    if (index !== -1) hooks.splice(index, 1)
  }
}
