import { Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { boxCollider, capsuleCollider, Collider, RigidBody, rigidBody, sphereCollider, Transform } from '../components'
import type { Engine } from '../core/Engine'
import { EventBus } from '../core/EventBus'
import { World } from '../ecs/World'
import { loadRapier, RapierPhysics } from './rapier'

function fakeEngine() {
  return {
    world: new World(),
    events: new EventBus<{ collisionEnter: { a: number; b: number }; collisionExit: { a: number; b: number } }>(),
    physics: { gravity: new Vector3(0, -25, 0) },
    time: { alpha: 1 },
  } as unknown as Engine
}

function spawn(engine: Engine, position: [number, number, number], rotationZ = 0) {
  const object = new Object3D()
  object.position.set(...position)
  object.rotation.z = rotationZ
  object.updateMatrixWorld()
  const entity = engine.world.create()
  engine.world.add(entity, Transform, object)
  return { entity, object }
}

async function setup() {
  const R = await loadRapier()
  const engine = fakeEngine()
  const physics = new RapierPhysics(engine, R)
  const [step] = physics.systems()
  const run = (steps: number) => {
    for (let i = 0; i < steps; i++) step.run(engine, 1 / 60)
  }
  return { engine, physics, run }
}

describe('RapierPhysics', () => {
  it('lands a character on the ground and reports grounded', async () => {
    const { engine, run } = await setup()
    const ground = spawn(engine, [0, -0.5, 0])
    engine.world.add(ground.entity, Collider, boxCollider(10, 0.5, 10))
    const player = spawn(engine, [0, 3, 0])
    engine.world.add(player.entity, RigidBody, rigidBody(player.object, { character: true }))
    engine.world.add(player.entity, Collider, capsuleCollider(0.4, 0.5))

    run(120)
    const body = engine.world.get(player.entity, RigidBody)
    expect(body.grounded).toBe(true)
    expect(body.position.y).toBeGreaterThan(0.85)
    expect(body.position.y).toBeLessThan(1.0)
  })

  it('rolls a ball down a rotated ramp (rotation is honored)', async () => {
    const { engine, run } = await setup()
    const ramp = spawn(engine, [0, 0, 0], -0.4)
    engine.world.add(ramp.entity, Collider, boxCollider(6, 0.2, 2))
    const ball = spawn(engine, [0, 2, 0])
    engine.world.add(ball.entity, RigidBody, rigidBody(ball.object))
    engine.world.add(ball.entity, Collider, sphereCollider(0.3))

    run(90)
    // The ramp tilts down toward +x, so the ball must have moved that way.
    expect(engine.world.get(ball.entity, RigidBody).position.x).toBeGreaterThan(0.5)
  })

  it('emits trigger enter events and raycasts hit colliders', async () => {
    const { engine, physics, run } = await setup()
    const entered: number[] = []
    engine.events.on('collisionEnter', ({ a, b }) => entered.push(a, b))
    const trigger = spawn(engine, [0, 0, 0])
    engine.world.add(trigger.entity, Collider, sphereCollider(1, { trigger: true }))
    const crate = spawn(engine, [0, 3, 0])
    engine.world.add(crate.entity, RigidBody, rigidBody(crate.object))
    engine.world.add(crate.entity, Collider, boxCollider(0.5, 0.5, 0.5))

    run(60)
    expect(entered).toContain(trigger.entity)
    const wall = spawn(engine, [5, 0, 0])
    engine.world.add(wall.entity, Collider, boxCollider(0.5, 2, 2))
    run(1)
    const hit = physics.raycast(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 20)
    expect(hit?.entity).toBe(wall.entity)
    expect(hit?.distance).toBeCloseTo(4.5, 1)
  })

  it('applies an impulse to a body spawned this frame (before its first step)', async () => {
    const { engine, physics, run } = await setup()
    const ball = spawn(engine, [0, 5, 0])
    engine.world.add(ball.entity, RigidBody, rigidBody(ball.object, { gravityScale: 0, mass: 1 }))
    engine.world.add(ball.entity, Collider, sphereCollider(0.3))
    physics.applyImpulse(ball.entity, new Vector3(0, 0, -5))
    run(30)
    expect(engine.world.get(ball.entity, RigidBody).position.z).toBeLessThan(-1)
  })
})
