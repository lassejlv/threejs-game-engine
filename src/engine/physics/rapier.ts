import type RAPIER_NS from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { Collider, type ColliderData, RigidBody, type RigidBodyData, Transform } from '../components'
import type { Engine } from '../core/Engine'
import type { System } from '../core/System'
import type { Entity } from '../ecs/component'

type Rapier = typeof RAPIER_NS
type RapierBody = RAPIER_NS.RigidBody
type RapierCollider = RAPIER_NS.Collider
type CharacterController = RAPIER_NS.KinematicCharacterController

let rapier: Promise<Rapier> | null = null

/** Loads and initializes Rapier (WASM). Code-split: nothing is downloaded until the first call. */
export function loadRapier(): Promise<Rapier> {
  rapier ??= import('@dimforge/rapier3d-compat').then(async (module) => {
    const R = (module.default ?? module) as Rapier
    await R.init()
    return R
  })
  return rapier
}

export interface RaycastHit {
  entity: Entity
  point: Vector3
  normal: Vector3
  distance: number
}

export interface RaycastOptions {
  /** Entity whose collider is ignored (usually the caster). */
  exclude?: Entity
  /** Also hit trigger colliders. Default false. */
  triggers?: boolean
}

interface BodyRecord {
  body: RapierBody
  collider: RapierCollider | null
  controller: CharacterController | null
  /** Distance from the body origin to the bottom of its collider (for ground probing). */
  footDepth: number
  /** State last written to/read from Rapier, to detect script changes (teleports, velocity edits). */
  syncedPosition: Vector3
  syncedVelocity: Vector3
}

const position = new Vector3()
const quaternion = new Quaternion()
const scale = new Vector3()
const down = { x: 0, y: -1, z: 0 }

/**
 * Rapier-backed physics using the engine's RigidBody and Collider components:
 * exact shapes (box, sphere, capsule, cylinder) with rotation, a kinematic
 * character controller, collision events and raycasts.
 *
 * Use it instead of the built-in physics: give the scene `physics: false`
 * and add `physics.systems()`.
 */
export class RapierPhysics {
  readonly world: RAPIER_NS.World
  private readonly events: RAPIER_NS.EventQueue
  private readonly bodies = new Map<Entity, BodyRecord>()
  /** Colliders without a rigid body (static geometry, triggers). */
  private readonly statics = new Map<Entity, { collider: RapierCollider; position: Vector3; quaternion: Quaternion }>()
  private readonly entityOf = new Map<number, Entity>()
  private readonly pending = new Set<Entity>()
  private readonly unhook: (() => void)[] = []

  constructor(
    private readonly engine: Engine,
    private readonly R: Rapier,
  ) {
    const g = engine.physics.gravity
    this.world = new R.World({ x: g.x, y: g.y, z: g.z })
    this.events = new R.EventQueue(true)
    const { world } = engine
    const queue = (entity: Entity) => this.pending.add(entity)
    const drop = (entity: Entity) => {
      this.pending.add(entity) // recreate without the removed part (or not at all)
      this.remove(entity)
    }
    this.unhook.push(
      world.onAdd(RigidBody, queue),
      world.onAdd(Collider, queue),
      world.onRemove(RigidBody, drop),
      world.onRemove(Collider, drop),
      world.onRemove(Transform, (entity) => {
        this.remove(entity)
        this.pending.delete(entity)
      }),
    )
    for (const entity of world.query(Collider).entities) this.pending.add(entity)
    for (const entity of world.query(RigidBody).entities) this.pending.add(entity)
  }

  systems(): System[] {
    return [
      {
        name: 'rapier.step',
        phase: 'fixed',
        order: 0,
        run: (_engine, dt) => this.step(dt),
        init: () => () => this.dispose(),
      },
      {
        name: 'rapier.interpolate',
        phase: 'update',
        order: -1000,
        run: () => this.interpolate(),
      },
    ]
  }

  raycast(origin: Vector3, direction: Vector3, maxDistance = 100, { exclude, triggers = false }: RaycastOptions = {}): RaycastHit | null {
    const dir = direction.clone().normalize()
    const ray = new this.R.Ray(origin, dir)
    const excluded = exclude === undefined ? undefined : this.colliderOf(exclude)
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      triggers ? undefined : this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      excluded ?? undefined,
    )
    if (!hit) return null
    const entity = this.entityOf.get(hit.collider.handle)
    if (entity === undefined) return null
    return {
      entity,
      distance: hit.timeOfImpact,
      point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    }
  }

  applyImpulse(entity: Entity, impulse: Vector3): void {
    // Bodies are normally built at the next step; an impulse right after spawning needs it now.
    if (this.pending.has(entity)) {
      this.pending.delete(entity)
      this.create(entity)
    }
    const record = this.bodies.get(entity)
    if (!record || record.body.isKinematic()) return
    record.body.applyImpulse(impulse, true)
    const v = record.body.linvel()
    const data = this.engine.world.tryGet(entity, RigidBody)
    data?.velocity.set(v.x, v.y, v.z)
    record.syncedVelocity.set(v.x, v.y, v.z)
  }

  dispose(): void {
    for (const off of this.unhook) off()
    this.unhook.length = 0
    this.bodies.clear()
    this.statics.clear()
    this.events.free()
    this.world.free()
  }

  private step(dt: number): void {
    const { world: ecs, physics } = this.engine
    for (const entity of this.pending) this.create(entity)
    this.pending.clear()

    const g = physics.gravity
    this.world.gravity = { x: g.x, y: g.y, z: g.z }
    this.world.timestep = dt
    const bodies = ecs.store(RigidBody)

    // Push script-side changes into Rapier and move characters.
    for (const [entity, record] of this.bodies) {
      const data = bodies.get(entity)
      if (!data) continue
      data.previous.copy(data.position)
      data.previousRotation.copy(data.rotation)
      const { body } = record
      if (data.character && record.controller && record.collider) {
        this.moveCharacter(data, record, dt)
      } else if (body.isKinematic()) {
        data.position.addScaledVector(data.velocity, dt)
        body.setNextKinematicTranslation(data.position)
        body.setNextKinematicRotation(data.rotation)
      } else {
        if (!data.position.equals(record.syncedPosition)) body.setTranslation(data.position, true)
        if (!data.velocity.equals(record.syncedVelocity)) body.setLinvel(data.velocity, true)
      }
    }

    this.syncStatics()
    this.world.step(this.events)

    // Read results back.
    for (const [entity, record] of this.bodies) {
      const data = bodies.get(entity)
      if (!data || record.body.isKinematic()) continue
      const t = record.body.translation()
      const r = record.body.rotation()
      const v = record.body.linvel()
      data.position.set(t.x, t.y, t.z)
      data.rotation.set(r.x, r.y, r.z, r.w)
      data.velocity.set(v.x, v.y, v.z)
      record.syncedPosition.copy(data.position)
      record.syncedVelocity.copy(data.velocity)
      data.grounded = this.probeGround(record, data)
    }

    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.entityOf.get(h1)
      const b = this.entityOf.get(h2)
      if (a === undefined || b === undefined) return
      this.engine.events.emit(started ? 'collisionEnter' : 'collisionExit', { a, b })
    })
  }

  private moveCharacter(data: RigidBodyData, record: BodyRecord, dt: number): void {
    const g = this.engine.physics.gravity
    data.velocity.addScaledVector(g, data.gravityScale * dt)
    const desired = { x: data.velocity.x * dt, y: data.velocity.y * dt, z: data.velocity.z * dt }
    const controller = record.controller!
    controller.computeColliderMovement(record.collider!, desired, this.R.QueryFilterFlags.EXCLUDE_SENSORS)
    const moved = controller.computedMovement()
    data.grounded = controller.computedGrounded()
    if (data.grounded && data.velocity.y < 0) data.velocity.y = 0
    // Hit a ceiling: stop rising.
    if (desired.y > 0 && moved.y < desired.y * 0.5) data.velocity.y = 0
    data.position.x += moved.x
    data.position.y += moved.y
    data.position.z += moved.z
    record.body.setNextKinematicTranslation(data.position)
  }

  /** Dynamic bodies are grounded when a short downward ray hits something just below them. */
  private probeGround(record: BodyRecord, data: RigidBodyData): boolean {
    if (!record.collider || data.velocity.y > 1) return false
    const ray = new this.R.Ray(record.body.translation(), down)
    const hit = this.world.castRay(ray, record.footDepth + 0.08, true, this.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, record.collider)
    return hit !== null
  }

  /** Static colliders follow their Transform (e.g. bobbing triggers, editor-moved platforms). */
  private syncStatics(): void {
    const transforms = this.engine.world.store(Transform)
    for (const [entity, entry] of this.statics) {
      const object = transforms.get(entity)
      if (!object) continue
      object.updateWorldMatrix(true, false)
      object.matrixWorld.decompose(position, quaternion, scale)
      if (position.equals(entry.position) && quaternion.equals(entry.quaternion)) continue
      entry.position.copy(position)
      entry.quaternion.copy(quaternion)
      const data = this.engine.world.get(entity, Collider)
      const offset = data.offset.clone().applyQuaternion(quaternion)
      entry.collider.setTranslation(position.add(offset))
      entry.collider.setRotation(quaternion)
    }
  }

  private interpolate(): void {
    const { world, time } = this.engine
    const bodies = world.store(RigidBody)
    const transforms = world.store(Transform)
    const alpha = time.alpha
    for (const entity of this.bodies.keys()) {
      const data = bodies.get(entity)
      const object = transforms.get(entity)
      if (!data || !object) continue
      if (data.interpolate) object.position.lerpVectors(data.previous, data.position, alpha)
      else object.position.copy(data.position)
      // Characters and rotation-locked bodies leave rotation to scripts.
      if (!data.character && !data.lockRotation) {
        if (data.interpolate) object.quaternion.slerpQuaternions(data.previousRotation, data.rotation, alpha)
        else object.quaternion.copy(data.rotation)
      }
    }
  }

  private create(entity: Entity): void {
    const { R } = this
    const ecs = this.engine.world
    this.remove(entity)
    const object = ecs.tryGet(entity, Transform)
    const data = ecs.tryGet(entity, RigidBody)
    const shape = ecs.tryGet(entity, Collider)
    if (!object || (!data && !shape)) return

    object.updateWorldMatrix(true, false)
    object.matrixWorld.decompose(position, quaternion, scale)

    if (!data) {
      const desc = this.colliderDesc(shape!, undefined)
      const offset = shape!.offset.clone().applyQuaternion(quaternion)
      desc.setTranslation(position.x + offset.x, position.y + offset.y, position.z + offset.z).setRotation(quaternion)
      const collider = this.world.createCollider(desc)
      this.entityOf.set(collider.handle, entity)
      this.statics.set(entity, { collider, position: position.clone(), quaternion: quaternion.clone() })
      return
    }

    data.rotation.copy(quaternion)
    data.previousRotation.copy(quaternion)
    const desc = data.character || data.kinematic ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic()
    desc
      .setTranslation(data.position.x, data.position.y, data.position.z)
      .setRotation(data.rotation)
      .setLinvel(data.velocity.x, data.velocity.y, data.velocity.z)
      .setLinearDamping(data.damping)
      .setGravityScale(data.gravityScale)
    if (data.lockRotation || data.character) desc.lockRotations()
    if (!data.kinematic && !data.character) desc.setCcdEnabled(true)
    const body = this.world.createRigidBody(desc)

    let collider: RapierCollider | null = null
    if (shape) {
      const cdesc = this.colliderDesc(shape, data)
      cdesc.setTranslation(shape.offset.x, shape.offset.y, shape.offset.z)
      collider = this.world.createCollider(cdesc, body)
      this.entityOf.set(collider.handle, entity)
    }

    let controller: CharacterController | null = null
    if (data.character) {
      if (!collider) console.warn('[physics] a character body needs a collider')
      controller = this.world.createCharacterController(0.02)
      controller.enableAutostep(0.35, 0.2, true)
      controller.enableSnapToGround(0.3)
      controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
      controller.setMinSlopeSlideAngle((35 * Math.PI) / 180)
      controller.setApplyImpulsesToDynamicBodies(true)
    }

    this.bodies.set(entity, {
      body,
      collider,
      controller,
      footDepth: shape ? shape.halfExtents.y - shape.offset.y : 0,
      syncedPosition: data.position.clone(),
      syncedVelocity: data.velocity.clone(),
    })
  }

  private colliderDesc(shape: ColliderData, body: RigidBodyData | undefined): RAPIER_NS.ColliderDesc {
    const { R } = this
    const desc =
      shape.shape === 'sphere'
        ? R.ColliderDesc.ball(shape.radius)
        : shape.shape === 'capsule'
          ? R.ColliderDesc.capsule(shape.halfHeight, shape.radius)
          : shape.shape === 'cylinder'
            ? R.ColliderDesc.cylinder(shape.halfHeight, shape.radius)
            : R.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
    desc
      .setSensor(shape.trigger)
      .setFriction(shape.friction)
      .setRestitution(body?.restitution ?? 0)
      .setCollisionGroups(((shape.layer & 0xffff) << 16) | (shape.mask & 0xffff))
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    // Triggers and characters must also see kinematic/static partners.
    if (shape.trigger || body?.character || body?.kinematic) desc.setActiveCollisionTypes(R.ActiveCollisionTypes.ALL)
    if (body && body.mass > 0) desc.setMass(body.mass)
    return desc
  }

  private colliderOf(entity: Entity): RapierCollider | null {
    return this.bodies.get(entity)?.collider ?? this.statics.get(entity)?.collider ?? null
  }

  private remove(entity: Entity): void {
    const record = this.bodies.get(entity)
    if (record) {
      if (record.collider) this.entityOf.delete(record.collider.handle)
      if (record.controller) this.world.removeCharacterController(record.controller)
      this.world.removeRigidBody(record.body) // also removes attached colliders
      this.bodies.delete(entity)
    }
    const entry = this.statics.get(entity)
    if (entry) {
      this.entityOf.delete(entry.collider.handle)
      this.world.removeCollider(entry.collider, false)
      this.statics.delete(entity)
    }
  }
}
