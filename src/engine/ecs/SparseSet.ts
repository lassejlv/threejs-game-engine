/**
 * Sparse set keyed by small integer ids. O(1) add/remove/lookup and
 * cache-friendly iteration over the packed `dense` / `values` arrays.
 */
export class SparseSet<T> {
  private sparse = new Int32Array(64).fill(-1)
  /** Packed ids. Order changes on delete (swap-remove). */
  readonly dense: number[] = []
  /** Packed values, parallel to `dense`. */
  readonly values: T[] = []

  get size(): number {
    return this.dense.length
  }

  has(id: number): boolean {
    return id < this.sparse.length && this.sparse[id] !== -1
  }

  get(id: number): T | undefined {
    if (id >= this.sparse.length) return undefined
    const index = this.sparse[id]
    return index === -1 ? undefined : this.values[index]
  }

  set(id: number, value: T): void {
    if (id >= this.sparse.length) this.grow(id)
    const index = this.sparse[id]
    if (index !== -1) {
      this.values[index] = value
      return
    }
    this.sparse[id] = this.dense.length
    this.dense.push(id)
    this.values.push(value)
  }

  delete(id: number): boolean {
    if (!this.has(id)) return false
    const index = this.sparse[id]
    const last = this.dense.length - 1
    const lastId = this.dense[last]
    this.dense[index] = lastId
    this.values[index] = this.values[last]
    this.sparse[lastId] = index
    this.dense.pop()
    this.values.pop()
    this.sparse[id] = -1
    return true
  }

  clear(): void {
    for (const id of this.dense) this.sparse[id] = -1
    this.dense.length = 0
    this.values.length = 0
  }

  private grow(id: number): void {
    let length = this.sparse.length
    while (length <= id) length *= 2
    const next = new Int32Array(length).fill(-1)
    next.set(this.sparse)
    this.sparse = next
  }
}
