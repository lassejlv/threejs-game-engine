import { Object3D, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  boxCollider,
  capsuleCollider,
  Collider,
  convexCollider,
  heightfieldCollider,
  Joint,
  joint,
  meshCollider,
  RigidBody,
  rigidBody,
  sphereCollider,
  Transform,
} from '../components'
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

  it('keeps a ball-jointed pendulum at a fixed distance from its world anchor', async () => {
    const { engine, run } = await setup()
    const bob = spawn(engine, [2, 5, 0])
    engine.world.add(bob.entity, RigidBody, rigidBody(bob.object))
    engine.world.add(bob.entity, Collider, sphereCollider(0.2))
    // Anchor 2 m to the left of the bob, i.e. at the world point (0, 5, 0).
    engine.world.add(bob.entity, Joint, joint('ball', null, { anchor: new Vector3(-2, 0, 0) }))
    run(40)
    const p = engine.world.get(bob.entity, RigidBody).position
    expect(p.y).toBeLessThan(4.5) // it swung down
    expect(p.distanceTo(new Vector3(0, 5, 0))).toBeCloseTo(2, 1)
  })

  it('hinges around the given axis only', async () => {
    const { engine, run } = await setup()
    const door = spawn(engine, [1, 2, 0])
    engine.world.add(door.entity, RigidBody, rigidBody(door.object, { gravityScale: 0 }))
    engine.world.add(door.entity, Collider, boxCollider(1, 1, 0.05))
    engine.world.add(door.entity, Joint, joint('hinge', null, { anchor: new Vector3(-1, 0, 0), axis: new Vector3(0, 1, 0) }))
    run(1)
    const body = engine.world.get(door.entity, RigidBody)
    body.velocity.set(0, 0, 2) // push the free edge
    run(30)
    // The hinge line (x = 0) stays put; the door turns around it without drifting up or down.
    expect(body.position.distanceTo(new Vector3(0, 2, 0))).toBeCloseTo(1, 1)
    expect(body.position.y).toBeCloseTo(2, 1)
    expect(body.position.z).toBeGreaterThan(0.1)
  })

  it('locks two bodies together with a fixed joint', async () => {
    const { engine, run } = await setup()
    const a = spawn(engine, [0, 5, 0])
    engine.world.add(a.entity, RigidBody, rigidBody(a.object))
    engine.world.add(a.entity, Collider, sphereCollider(0.3))
    const b = spawn(engine, [1, 5, 0])
    engine.world.add(b.entity, RigidBody, rigidBody(b.object))
    engine.world.add(b.entity, Collider, sphereCollider(0.3))
    engine.world.add(b.entity, Joint, joint('fixed', a.entity))
    run(30)
    const pa = engine.world.get(a.entity, RigidBody).position
    const pb = engine.world.get(b.entity, RigidBody).position
    expect(pa.y).toBeLessThan(4.5)
    expect(pa.distanceTo(pb)).toBeCloseTo(1, 1)
  })

  it('collides with triangle-mesh and convex shapes', async () => {
    const { engine, run } = await setup()
    const floor = spawn(engine, [0, 0, 0])
    const quad = new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5])
    engine.world.add(floor.entity, Collider, meshCollider(quad, new Uint32Array([0, 2, 1, 0, 3, 2])))
    const rock = spawn(engine, [0, 3, 0])
    engine.world.add(rock.entity, RigidBody, rigidBody(rock.object))
    const tetra = new Float32Array([0, 0.5, 0, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, -0.5, 0.5])
    engine.world.add(rock.entity, Collider, convexCollider(tetra))
    run(120)
    const y = engine.world.get(rock.entity, RigidBody).position.y
    expect(y).toBeGreaterThan(0.3)
    expect(y).toBeLessThan(0.7)
  })

  it('applies forces for one step at a time', async () => {
    const { engine, physics, run } = await setup()
    const puck = spawn(engine, [0, 5, 0])
    engine.world.add(puck.entity, RigidBody, rigidBody(puck.object, { gravityScale: 0, mass: 1 }))
    engine.world.add(puck.entity, Collider, sphereCollider(0.2))
    run(1)
    for (let i = 0; i < 30; i++) {
      physics.addForce(puck.entity, new Vector3(10, 0, 0))
      run(1)
    }
    const v = engine.world.get(puck.entity, RigidBody).velocity.x
    expect(v).toBeCloseTo(5, 0) // 10 N on ~1 kg for 0.5 s
    run(30)
    expect(engine.world.get(puck.entity, RigidBody).velocity.x).toBeCloseTo(v, 1) // no force left over
  })

  it('finds overlapping colliders and sweeps spheres', async () => {
    const { engine, physics, run } = await setup()
    const near = spawn(engine, [1, 0, 0])
    engine.world.add(near.entity, Collider, boxCollider(0.5, 0.5, 0.5))
    const far = spawn(engine, [10, 0, 0])
    engine.world.add(far.entity, Collider, boxCollider(0.5, 0.5, 0.5))
    run(1)
    expect(physics.overlap(new Vector3(0, 0, 0), 1)).toEqual([near.entity])
    expect(physics.overlap(new Vector3(10, 0, 0), new Vector3(1, 1, 1))).toEqual([far.entity])
    const hit = physics.sphereCast(new Vector3(-5, 0, 0), 0.5, new Vector3(1, 0, 0), 20)
    expect(hit?.entity).toBe(near.entity)
    expect(hit?.distance).toBeCloseTo(5, 1) // 5 to the box face (x = 0.5) minus the radius
  })

  it('ignores collisions between layers that do not interact', async () => {
    const { engine, run } = await setup()
    const floor = spawn(engine, [0, -0.5, 0])
    engine.world.add(floor.entity, Collider, boxCollider(5, 0.5, 5, { layer: 0b01, mask: 0b01 }))
    const ghost = spawn(engine, [0, 2, 0])
    engine.world.add(ghost.entity, RigidBody, rigidBody(ghost.object))
    engine.world.add(ghost.entity, Collider, sphereCollider(0.3, { layer: 0b10, mask: 0b10 }))
    run(90)
    expect(engine.world.get(ghost.entity, RigidBody).position.y).toBeLessThan(-2)
  })

  it('lands bodies on a heightfield where its heights say', async () => {
    const { engine, physics, run } = await setup()
    // 3×3 samples over 10×10 m: flat, except a 2 m peak at the +x, -z corner.
    const heights = new Float32Array(9)
    heights[0 * 3 + 2] = 2 // row z = -5, column x = +5
    const ground = spawn(engine, [0, 0, 0])
    engine.world.add(ground.entity, Collider, heightfieldCollider(heights, 3, 10, 10))
    run(1)
    const down = new Vector3(0, -1, 0)
    expect(physics.raycast(new Vector3(5, 10, -5), down, 20)!.point.y).toBeCloseTo(2, 1)
    expect(physics.raycast(new Vector3(-5, 10, 5), down, 20)!.point.y).toBeCloseTo(0, 1)
    expect(physics.raycast(new Vector3(0, 10, 0), down, 20)!.point.y).toBeCloseTo(0, 1)
  })
})
