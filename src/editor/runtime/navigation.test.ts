import { Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { boxCollider, Collider, defaultNavSettings, type Engine, EventBus, loadRapier, RapierPhysics, Transform, World } from '../../engine'
import type { Handle } from '../scripting'
import { Navigation } from './navigation'

async function setup() {
  const R = await loadRapier()
  const engine = {
    world: new World(),
    events: new EventBus(),
    physics: { gravity: new Vector3(0, -25, 0) },
    time: { alpha: 1 },
  } as unknown as Engine
  const physics = new RapierPhysics(engine, R)
  const solid = (at: [number, number, number], half: [number, number, number]) => {
    const object = new Object3D()
    object.position.set(...at)
    object.updateMatrixWorld()
    const entity = engine.world.create()
    engine.world.add(entity, Transform, object)
    engine.world.add(entity, Collider, boxCollider(...half))
  }
  solid([0, -0.5, 0], [10, 0.5, 10])
  solid([0, 1.5, -2], [0.25, 1.5, 8]) // wall with a gap at the +z end
  const navigation = new Navigation(physics, defaultNavSettings(), (entity) => engine.world.isAlive(entity))
  const walker = (x: number, z: number): Handle => {
    const object = new Object3D()
    object.position.set(x, 0.5, z)
    return { entity: engine.world.create(), name: 'Walker', object, body: undefined }
  }
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) navigation.update(1 / 60)
  }
  return { navigation, walker, run }
}

describe('Navigation', () => {
  it('walks an entity around a wall to its goal and stops', async () => {
    const { navigation, walker, run } = await setup()
    const guard = walker(-5, -5)
    const api = navigation.api(guard)
    expect(api.moveTo({ x: 5, y: 0, z: -5 }, { speed: 6 })).toBe(true)
    expect(api.moving).toBe(true)
    let crossedGap = false
    for (let i = 0; i < 12; i++) {
      run(0.5)
      if (Math.abs(guard.object.position.x) < 0.5 && guard.object.position.z > 6) crossedGap = true
    }
    expect(crossedGap).toBe(true)
    expect(guard.object.position.distanceTo(new Vector3(5, 0.5, -5))).toBeLessThan(0.6)
    expect(api.moving).toBe(false)
  })

  it('reports unreachable goals', async () => {
    const { navigation, walker } = await setup()
    const api = navigation.api(walker(-5, -5))
    expect(api.moveTo({ x: 50, y: 0, z: 50 })).toBe(false)
    expect(api.findPath({ x: -5, y: 0, z: -5 }, { x: 5, y: 0, z: -5 })?.length).toBeGreaterThan(2)
  })

  it('keeps following a moving target', async () => {
    const { navigation, walker, run } = await setup()
    const hunter = walker(-5, 5)
    const prey = walker(-5, -5)
    navigation.api(hunter).moveTo(prey, { speed: 5, stoppingDistance: 1 })
    run(2)
    prey.object.position.set(-8, 0.5, -8)
    run(3)
    expect(hunter.object.position.distanceTo(prey.object.position)).toBeLessThan(1.6)
    expect(navigation.api(hunter).moving).toBe(true) // chasing doesn't end on arrival
  })
})
