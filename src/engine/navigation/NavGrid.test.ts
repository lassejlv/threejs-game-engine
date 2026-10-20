import { Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { boxCollider, Collider, Transform } from '../components'
import type { Engine } from '../core/Engine'
import { EventBus } from '../core/EventBus'
import { World } from '../ecs/World'
import { loadRapier, RapierPhysics } from '../physics/rapier'
import { NavGrid } from './NavGrid'

async function level(boxes: { at: [number, number, number]; half: [number, number, number]; rotZ?: number }[]) {
  const R = await loadRapier()
  const engine = {
    world: new World(),
    events: new EventBus(),
    physics: { gravity: new Vector3(0, -25, 0) },
    time: { alpha: 1 },
  } as unknown as Engine
  const physics = new RapierPhysics(engine, R)
  for (const b of boxes) {
    const object = new Object3D()
    object.position.set(...b.at)
    object.rotation.z = b.rotZ ?? 0
    object.updateMatrixWorld()
    const entity = engine.world.create()
    engine.world.add(entity, Transform, object)
    engine.world.add(entity, Collider, boxCollider(...b.half))
  }
  physics.flush()
  return physics
}

const bounds = (half: number, low = -1, high = 6) => ({ min: new Vector3(-half, low, -half), max: new Vector3(half, high, half) })
const length = (path: Vector3[]) => path.slice(1).reduce((sum, p, i) => sum + p.distanceTo(path[i]), 0)

describe('NavGrid', () => {
  it('walks straight across open ground', async () => {
    const physics = await level([{ at: [0, -0.5, 0], half: [10, 0.5, 10] }])
    const grid = NavGrid.bake(physics.navQueries(), bounds(10))
    const path = grid.findPath(new Vector3(-8, 0, 0), new Vector3(8, 0, 0))!
    expect(path).not.toBeNull()
    expect(path.length).toBe(2) // straightened to one segment
    expect(path[0].y).toBeCloseTo(0, 1)
  })

  it('routes around a wall through its gap', async () => {
    const physics = await level([
      { at: [0, -0.5, 0], half: [10, 0.5, 10] },
      // Wall along x = 0 from z = -10 to z = 6, leaving a gap at the +z end.
      { at: [0, 1.5, -2], half: [0.25, 1.5, 8] },
    ])
    const grid = NavGrid.bake(physics.navQueries(), bounds(10))
    const path = grid.findPath(new Vector3(-5, 0, -5), new Vector3(5, 0, -5))!
    expect(path).not.toBeNull()
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(6) // went through the gap
    expect(length(path)).toBeGreaterThan(20)
  })

  it('returns null when the goal is on an unreachable island', async () => {
    const physics = await level([
      { at: [-5, -0.5, 0], half: [4, 0.5, 4] },
      { at: [6, 2, 0], half: [2, 0.5, 2] }, // a ledge 2.5 m up with no way onto it
    ])
    const grid = NavGrid.bake(physics.navQueries(), bounds(10))
    expect(grid.findPath(new Vector3(-5, 0, 0), new Vector3(6, 2.5, 0))).toBeNull()
  })

  it('keeps a bridge and the floor under it as separate floors', async () => {
    const physics = await level([
      { at: [0, -0.5, 0], half: [10, 0.5, 10] },
      { at: [0, 3, 0], half: [10, 0.2, 1] }, // bridge along x, 3 m up
    ])
    const grid = NavGrid.bake(physics.navQueries(), bounds(10))
    const under = grid.nodes[grid.nearest(new Vector3(0, 0, 0))]
    const over = grid.nodes[grid.nearest(new Vector3(0, 3.2, 0))]
    expect(under.y).toBeCloseTo(0, 1)
    expect(over.y).toBeCloseTo(3.2, 1)
    // Walking along the bridge stays on it.
    const path = grid.findPath(new Vector3(-8, 3.2, 0), new Vector3(8, 3.2, 0))!
    expect(path.every((p) => p.y > 3)).toBe(true)
  })

  it('treats steep slopes as unwalkable', async () => {
    const physics = await level([
      { at: [0, -0.5, 0], half: [10, 0.5, 10] },
      { at: [5, 0, 0], half: [3, 0.1, 3], rotZ: 1.1 }, // ~63°
    ])
    const grid = NavGrid.bake(physics.navQueries(), bounds(10))
    const onSlope = grid.nodes.filter((n) => Math.abs(n.x - 5) < 1 && n.y > 0.5)
    expect(onSlope).toHaveLength(0)
  })
})
