import type RAPIER_NS from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { Collider, type ColliderData, Joint, RigidBody, type RigidBodyData, Transform } from '../components'
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

export interface ShapeHit {
  entity: Entity
  point: Vector3
  normal: Vector3
  distance: number
}

/** Line segments of every collider and joint (Rapier's debug renderer), in world space. */
export interface DebugLines {
  vertices: Float32Array
  colors: Float32Array
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
const identity = { x: 0, y: 0, z: 0, w: 1 }

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
  private readonly joints = new Map<Entity, RAPIER_NS.ImpulseJoint>()
  private readonly pendingJoints = new Set<Entity>()
  /** Bodies with forces or torques this step; Rapier keeps forces until reset. */
  private readonly forced = new Set<RapierBody>()
  /** Fixed body that world-anchored joints attach to. */
  private ground: RapierBody | null = null
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
        this.removeJoint(entity)
      }),
      world.onAdd(Joint, (entity) => this.pendingJoints.add(entity)),
      world.onRemove(Joint, (entity) => this.removeJoint(entity)),
    )
    for (const entity of world.query(Collider).entities) this.pending.add(entity)
    for (const entity of world.query(RigidBody).entities) this.pending.add(entity)
    for (const entity of world.query(Joint).entities) this.pendingJoints.add(entity)
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

  /** Continuous force for this step (dynamic bodies). Call every fixed step to keep pushing. */
  addForce(entity: Entity, force: Vector3): void {
    const body = this.dynamicBody(entity)
    if (!body) return
    body.addForce(force, true)
    this.forced.add(body)
  }

  /** Continuous torque for this step (dynamic bodies). */
  addTorque(entity: Entity, torque: Vector3): void {
    const body = this.dynamicBody(entity)
    if (!body) return
    body.addTorque(torque, true)
    this.forced.add(body)
  }

  /** Instant spin change scaled by inertia. */
  applyTorqueImpulse(entity: Entity, impulse: Vector3): void {
    this.dynamicBody(entity)?.applyTorqueImpulse(impulse, true)
  }

  angularVelocity(entity: Entity): Vector3 {
    const v = this.bodies.get(entity)?.body.angvel()
    return v ? new Vector3(v.x, v.y, v.z) : new Vector3()
  }

  setAngularVelocity(entity: Entity, velocity: Vector3): void {
    this.dynamicBody(entity)?.setAngvel(velocity, true)
  }

  /** Entities whose colliders overlap a sphere or box (`halfExtents`) at `center`. */
  overlap(center: Vector3, size: number | Vector3, { exclude, triggers = false }: RaycastOptions = {}): Entity[] {
    const { R } = this
    const shape = typeof size === 'number' ? new R.Ball(size) : new R.Cuboid(size.x, size.y, size.z)
    const found = new Set<Entity>()
    this.world.intersectionsWithShape(
      center,
      identity,
      shape,
      (collider) => {
        const entity = this.entityOf.get(collider.handle)
        if (entity !== undefined) found.add(entity)
        return true
      },
      triggers ? undefined : R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      exclude === undefined ? undefined : (this.colliderOf(exclude) ?? undefined),
    )
    return [...found]
  }

  /** Sweeps a sphere along a direction and returns the first collider it touches. */
  sphereCast(origin: Vector3, radius: number, direction: Vector3, maxDistance = 100, { exclude, triggers = false }: RaycastOptions = {}): ShapeHit | null {
    const { R } = this
    const dir = direction.clone().normalize()
    const hit = this.world.castShape(
      origin,
      identity,
      dir,
      new R.Ball(radius),
      0,
      maxDistance,
      true,
      triggers ? undefined : R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      exclude === undefined ? undefined : (this.colliderOf(exclude) ?? undefined),
    )
    if (!hit) return null
    const entity = this.entityOf.get(hit.collider.handle)
    if (entity === undefined) return null
    return {
      entity,
      distance: hit.time_of_impact,
      point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
      normal: new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
    }
  }

  debugLines(): DebugLines {
    const { vertices, colors } = this.world.debugRender()
    return { vertices, colors }
  }

  dispose(): void {
    for (const off of this.unhook) off()
    this.unhook.length = 0
    this.bodies.clear()
    this.statics.clear()
    this.joints.clear()
    this.events.free()
    this.world.free()
  }

  private step(dt: number): void {
    const { world: ecs, physics } = this.engine
    for (const entity of this.pending) this.create(entity)
    this.pending.clear()
    for (const entity of this.pendingJoints) this.createJoint(entity)
    this.pendingJoints.clear()

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
    for (const body of this.forced) {
      if (!this.world.bodies.contains(body.handle)) continue
      body.resetForces(false)
      body.resetTorques(false)
    }
    this.forced.clear()

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

    // Recreating a body drops its joints; rebuild them (and joints that target it).
    if (ecs.has(entity, Joint)) this.pendingJoints.add(entity)
    for (const [other] of this.joints) if (ecs.tryGet(other, Joint)?.target === entity) this.pendingJoints.add(other)

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
    const box = () => R.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
    const desc =
      shape.shape === 'sphere'
        ? R.ColliderDesc.ball(shape.radius)
        : shape.shape === 'capsule'
          ? R.ColliderDesc.capsule(shape.halfHeight, shape.radius)
          : shape.shape === 'cylinder'
            ? R.ColliderDesc.cylinder(shape.halfHeight, shape.radius)
            : shape.shape === 'mesh' && shape.vertices && shape.indices
              ? R.ColliderDesc.trimesh(shape.vertices, shape.indices)
              : shape.shape === 'convex' && shape.vertices
                ? (R.ColliderDesc.convexHull(shape.vertices) ?? box())
                : box()
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

  private dynamicBody(entity: Entity): RapierBody | null {
    if (this.pending.has(entity)) {
      this.pending.delete(entity)
      this.create(entity)
    }
    const body = this.bodies.get(entity)?.body
    return body && body.isDynamic() ? body : null
  }

  /**
   * Builds the joint on `entity`. Anchors and frames are taken from the bodies'
   * current poses, so the joint starts satisfied however the two bodies are rotated.
   */
  private createJoint(entity: Entity): void {
    const { R } = this
    const ecs = this.engine.world
    this.removeJoint(entity)
    const data = ecs.tryGet(entity, Joint)
    const record = this.bodies.get(entity)
    if (!data || !record) return
    const body1 = record.body
    const body2 = (data.target !== null && this.bodies.get(data.target)?.body) || this.groundBody(data.target)
    const p1 = body1.translation()
    const q1 = new Quaternion().copy(body1.rotation() as Quaternion)
    const p2 = new Vector3().copy(body2.translation() as Vector3)
    const q2inv = new Quaternion().copy(body2.rotation() as Quaternion).invert()
    const world = data.anchor.clone().applyQuaternion(q1).add(p1 as Vector3)
    const anchor2 = world.clone().sub(p2).applyQuaternion(q2inv)
    const a1 = { x: data.anchor.x, y: data.anchor.y, z: data.anchor.z }
    const axis = data.axis.clone().normalize()
    let params: RAPIER_NS.JointData
    switch (data.type) {
      case 'hinge':
        params = R.JointData.revolute(a1, anchor2, axis)
        break
      case 'slider':
        params = R.JointData.prismatic(a1, anchor2, axis)
        break
      case 'ball':
        params = R.JointData.spherical(a1, anchor2)
        break
      case 'spring': {
        // To another body: pulls toward its origin, resting at the starting distance by default.
        // To the world: pulls back toward where the anchor started.
        const toBody = data.target !== null && this.bodies.has(data.target)
        const end = toBody ? new Vector3() : anchor2
        const rest = data.restLength >= 0 ? data.restLength : toBody ? world.distanceTo(p2) : 0
        params = R.JointData.spring(rest, data.stiffness, data.damping, a1, end)
        break
      }
      default:
        params = R.JointData.fixed(a1, identity, anchor2, q2inv.clone().multiply(q1))
    }
    if (data.limits && (data.type === 'hinge' || data.type === 'slider')) {
      params.limitsEnabled = true
      params.limits = [data.limits[0], data.limits[1]]
    }
    const joint = this.world.createImpulseJoint(params, body1, body2, true)
    if (data.type !== 'fixed' && data.type !== 'spring') {
      // Express body 1's joint frame in body 2's space, so differently rotated bodies agree on the axis.
      const frame1 = new Quaternion().copy(joint.frameX1() as Quaternion)
      joint.setLocalFrame2(anchor2, q2inv.clone().multiply(q1).multiply(frame1))
    }
    if (data.motorStrength > 0 && (data.type === 'hinge' || data.type === 'slider')) {
      ;(joint as RAPIER_NS.UnitImpulseJoint).configureMotorVelocity(data.motorSpeed, data.motorStrength)
    }
    joint.setContactsEnabled(false)
    this.joints.set(entity, joint)
  }

  /** World anchor: a fixed body at the target's pose (or the origin when there is no target). */
  private groundBody(target: Entity | null): RapierBody {
    const object = target === null ? undefined : this.engine.world.tryGet(target, Transform)
    if (object) {
      object.updateWorldMatrix(true, false)
      object.matrixWorld.decompose(position, quaternion, scale)
      return this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(quaternion))
    }
    this.ground ??= this.world.createRigidBody(this.R.RigidBodyDesc.fixed())
    return this.ground
  }

  private removeJoint(entity: Entity): void {
    const joint = this.joints.get(entity)
    if (!joint) return
    this.joints.delete(entity)
    if (joint.isValid()) this.world.removeImpulseJoint(joint, true)
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
