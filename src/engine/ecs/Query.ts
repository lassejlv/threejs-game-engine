import type { AnyComponent, Entity } from './component'
import { SparseSet } from './SparseSet'

/**
 * A live, cached set of entities matching `all` and none of `none`.
 * Membership is updated incrementally as components change, so iterating
 * a query costs nothing beyond walking its packed entity list.
 */
export class Query {
  private readonly set = new SparseSet<true>()

  constructor(
    readonly all: readonly AnyComponent[],
    readonly none: readonly AnyComponent[],
  ) {}

  get size(): number {
    return this.set.size
  }

  /** Packed entity list. Read-only; order is not stable. */
  get entities(): readonly Entity[] {
    return this.set.dense
  }

  has(entity: Entity): boolean {
    return this.set.has(entity)
  }

  first(): Entity | undefined {
    return this.set.dense[0]
  }

  /**
   * Iterates back to front, so removing the current entity (or its
   * components) during iteration is safe.
   */
  [Symbol.iterator](): Iterator<Entity> {
    const dense = this.set.dense
    let i = dense.length
    return {
      next: () => (--i >= 0 ? { value: dense[i], done: false } : { value: undefined, done: true }),
    }
  }

  forEach(fn: (entity: Entity) => void): void {
    const dense = this.set.dense
    for (let i = dense.length - 1; i >= 0; i--) fn(dense[i])
  }

  /** @internal */
  _sync(entity: Entity, matches: boolean): void {
    if (matches) this.set.set(entity, true)
    else this.set.delete(entity)
  }

  /** @internal */
  _clear(): void {
    this.set.clear()
  }
}
