import { describe, expect, it } from 'vitest'
import { defineComponent, defineTag } from './component'
import { SparseSet } from './SparseSet'
import { World } from './World'

const Position = defineComponent<{ x: number }>('Position')
const Velocity = defineComponent<{ x: number }>('Velocity')
const Frozen = defineTag('Frozen')

describe('SparseSet', () => {
  it('adds, swap-removes and grows', () => {
    const set = new SparseSet<string>()
    set.set(1, 'a')
    set.set(500, 'b')
    set.set(3, 'c')
    expect(set.delete(1)).toBe(true)
    expect(set.has(1)).toBe(false)
    expect(set.get(500)).toBe('b')
    expect(set.get(3)).toBe('c')
    expect(set.size).toBe(2)
    expect(set.delete(1)).toBe(false)
  })
})

describe('World', () => {
  it('keeps queries in sync with component changes', () => {
    const world = new World()
    const moving = world.query({ all: [Position, Velocity], none: [Frozen] })
    const a = world.create()
    world.add(a, Position, { x: 0 })
    expect(moving.size).toBe(0)
    world.add(a, Velocity, { x: 1 })
    expect(moving.has(a)).toBe(true)
    world.add(a, Frozen)
    expect(moving.has(a)).toBe(false)
    world.remove(a, Frozen)
    expect(moving.has(a)).toBe(true)
    world.remove(a, Position)
    expect(moving.has(a)).toBe(false)
  })

  it('seeds new queries from existing entities and caches them', () => {
    const world = new World()
    const e = world.create()
    world.add(e, Position, { x: 0 })
    const q = world.query(Position)
    expect([...q]).toEqual([e])
    expect(world.query(Position)).toBe(q)
  })

  it('defers destroy until flush and recycles ids', () => {
    const world = new World()
    const q = world.query(Position)
    const removed: number[] = []
    world.onRemove(Position, (e) => removed.push(e))
    const e = world.create()
    world.add(e, Position, { x: 0 })
    world.destroy(e)
    expect(world.isAlive(e)).toBe(false)
    expect(q.has(e)).toBe(true)
    world.flush()
    expect(q.has(e)).toBe(false)
    expect(removed).toEqual([e])
    expect(world.create()).toBe(e)
  })

  it('allows removing the current entity while iterating', () => {
    const world = new World()
    const q = world.query(Position)
    for (let i = 0; i < 10; i++) world.add(world.create(), Position, { x: i })
    let visited = 0
    for (const e of q) {
      visited++
      world.remove(e, Position)
    }
    expect(visited).toBe(10)
    expect(q.size).toBe(0)
  })

  it('fires replace hooks when a component value changes', () => {
    const world = new World()
    const events: string[] = []
    world.onAdd(Position, (_, v) => events.push(`add ${v.x}`))
    world.onRemove(Position, (_, v) => events.push(`remove ${v.x}`))
    const e = world.create()
    world.add(e, Position, { x: 1 })
    world.add(e, Position, { x: 2 })
    expect(events).toEqual(['add 1', 'remove 1', 'add 2'])
  })
})
