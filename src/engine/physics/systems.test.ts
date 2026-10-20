import { Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { boxCollider, Collider, RigidBody, rigidBody, sphereCollider, Transform } from '../components'
import type { Engine } from '../core/Engine'
import { EventBus } from '../core/EventBus'
import { World } from '../ecs/World'
import { createCollisionSystem, createPhysicsSystem } from './systems'

/** The physics systems only touch world, events and physics settings. */
function fakeEngine() {
  return {
    world: new World(),
    events: new EventBus<{ collisionEnter: { a: number; b: number }; collisionExit: { a: number; b: number } }>(),
    physics: { gravity: new Vector3(0, -25, 0) },
  } as unknown as Engine
}

function simulate(engine: Engine, steps: number) {
  const physics = createPhysicsSystem()
  const collision = createCollisionSystem()
  for (let i = 0; i < steps; i++) {
    physics.run(engine, 1 / 60)
    collision.run(engine, 1 / 60)
  }
}

describe('physics + collision', () => {
  it('lands a falling box on static ground', () => {
    const engine = fakeEngine()
    const { world } = engine
    const ground = world.create()
    world.add(ground, Transform, new Object3D())
    world.add(ground, Collider, boxCollider(50, 0.5, 50))

    const box = new Object3D()
    box.position.set(0, 5, 0)
    const e = world.create()
    world.add(e, Transform, box)
    world.add(e, RigidBody, rigidBody(box))
    world.add(e, Collider, boxCollider(0.5, 0.5, 0.5))

    simulate(engine, 180)
    const body = world.get(e, RigidBody)
    expect(body.grounded).toBe(true)
    expect(body.position.y).toBeCloseTo(1, 1)
    expect(Math.abs(body.velocity.y)).toBeLessThan(1)
  })

  it('emits enter/exit for triggers without pushing', () => {
    const engine = fakeEngine()
    const { world, events } = engine
    const log: string[] = []
    events.on('collisionEnter', () => log.push('enter'))
    events.on('collisionExit', () => log.push('exit'))

    const trigger = world.create()
    world.add(trigger, Transform, new Object3D())
    world.add(trigger, Collider, sphereCollider(1, { trigger: true }))

    const mover = new Object3D()
    mover.position.set(-3, 0, 0)
    const e = world.create()
    world.add(e, Transform, mover)
    world.add(e, RigidBody, rigidBody(mover, { gravityScale: 0, velocity: new Vector3(6, 0, 0) }))
    world.add(e, Collider, boxCollider(0.5, 0.5, 0.5))

    simulate(engine, 120)
    expect(log).toEqual(['enter', 'exit'])
    expect(world.get(e, RigidBody).velocity.x).toBe(6)
  })
})
