import { type Object3D, Quaternion, Vector3 } from 'three'
import { defineComponent, type Entity } from './ecs/component'

/**
 * The entity's three.js object (Mesh, Group, Light, ...). Adding it puts
 * the object in the scene; removing it (or destroying the entity) takes it out.
 */
export const Transform = defineComponent<Object3D>('Transform')

export interface RigidBodyData {
  /** Authoritative simulation position. The Transform is interpolated from this. */
  position: Vector3
  /** Position at the previous fixed step (for interpolation). */
  previous: Vector3
  /** Authoritative rotation (Rapier only; the built-in physics ignores rotation). */
  rotation: Quaternion
  previousRotation: Quaternion
  velocity: Vector3
  gravityScale: number
  /** Linear damping per second. */
  damping: number
  /** Bounciness on contact, 0..1. */
  restitution: number
  /** Moved by code only: not affected by gravity or pushed by collisions. */
  kinematic: boolean
  /**
   * Character controller (Rapier): moved by its velocity with slope limits,
   * step climbing and ground snapping. Rotation is left to scripts.
   */
  character: boolean
  /** Prevents physics from rotating the body. */
  lockRotation: boolean
  /** 2D: moves only in the XY plane and turns only around Z (Rapier). */
  planar: boolean
  /** Mass in kg; 0 derives it from collider volume. */
  mass: number
  /** Interpolate the Transform between fixed steps. Default true. */
  interpolate: boolean
  /** Set by the collision system when resting on something below. */
  grounded: boolean
}

export const RigidBody = defineComponent<RigidBodyData>('RigidBody')

export function rigidBody(object: Object3D, options: Partial<RigidBodyData> = {}): RigidBodyData {
  return {
    position: object.position.clone(),
    previous: object.position.clone(),
    rotation: object.quaternion.clone(),
    previousRotation: object.quaternion.clone(),
    velocity: new Vector3(),
    gravityScale: 1,
    damping: 0,
    restitution: 0,
    kinematic: false,
    character: false,
    lockRotation: false,
    planar: false,
    mass: 0,
    interpolate: true,
    grounded: false,
    ...options,
  }
}

/** Moves a body without interpolating through the space in between. */
export function teleport(body: RigidBodyData, position: Vector3): void {
  body.position.copy(position)
  body.previous.copy(position)
}

export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'convex' | 'heightfield'

export interface ColliderData {
  shape: ColliderShape
  /**
   * Half size of the bounding box. The built-in physics treats every
   * non-sphere shape as this axis-aligned box; Rapier uses the exact shape.
   */
  halfExtents: Vector3
  /** Sphere, capsule and cylinder radius. */
  radius: number
  /** Capsule: half length of the straight segment. Cylinder: half height. */
  halfHeight: number
  /** Surface friction (Rapier). */
  friction: number
  /** Center offset from the entity position. */
  offset: Vector3
  /** Triggers report overlaps but never push. */
  trigger: boolean
  /** Bit layer this collider is on. */
  layer: number
  /** Bit mask of layers this collider interacts with. */
  mask: number
  /** Mesh and convex shapes: vertex positions (x, y, z) relative to the entity, scale applied. */
  vertices?: Float32Array
  /** Mesh shape: triangle indices into `vertices`. */
  indices?: Uint32Array
  /** Heightfield: `samples × samples` heights in meters, row by row from -z to +z (x within a row), centered on the entity. */
  heights?: Float32Array
  samples?: number
}

export const Collider = defineComponent<ColliderData>('Collider')

type ColliderOptions = Partial<Omit<ColliderData, 'shape' | 'halfExtents' | 'radius' | 'halfHeight'>>

function collider(
  shape: ColliderShape,
  halfExtents: Vector3,
  radius: number,
  halfHeight: number,
  options: ColliderOptions,
): ColliderData {
  return {
    shape,
    halfExtents,
    radius,
    halfHeight,
    friction: 0.5,
    offset: new Vector3(),
    trigger: false,
    layer: 1,
    mask: 0xffff,
    ...options,
  }
}

export function boxCollider(halfX: number, halfY: number, halfZ: number, options: ColliderOptions = {}): ColliderData {
  return collider('box', new Vector3(halfX, halfY, halfZ), 0, halfY, options)
}

export function sphereCollider(radius: number, options: ColliderOptions = {}): ColliderData {
  return collider('sphere', new Vector3(radius, radius, radius), radius, 0, options)
}

/** Upright capsule. `halfHeight` is half the straight segment (total height = 2 * (halfHeight + radius)). */
export function capsuleCollider(radius: number, halfHeight: number, options: ColliderOptions = {}): ColliderData {
  return collider('capsule', new Vector3(radius, halfHeight + radius, radius), radius, halfHeight, options)
}

/**
 * Triangle-mesh collider (exact surface). Best for static level geometry; dynamic bodies
 * should use `convexCollider`. Vertices are relative to the entity with its scale applied.
 */
export function meshCollider(vertices: Float32Array, indices: Uint32Array, options: ColliderOptions = {}): ColliderData {
  const data = collider('mesh', boundsHalfExtents(vertices), 0, 0, options)
  data.vertices = vertices
  data.indices = indices
  return data
}

/** Convex hull of the vertices: a closed, solid approximation that dynamic bodies can use. */
export function convexCollider(vertices: Float32Array, options: ColliderOptions = {}): ColliderData {
  const data = collider('convex', boundsHalfExtents(vertices), 0, 0, options)
  data.vertices = vertices
  return data
}

function boundsHalfExtents(v: Float32Array): Vector3 {
  const h = new Vector3()
  for (let i = 0; i < v.length; i += 3) h.set(Math.max(h.x, Math.abs(v[i])), Math.max(h.y, Math.abs(v[i + 1])), Math.max(h.z, Math.abs(v[i + 2])))
  return h
}

/** Terrain collider: a square grid of heights spanning `width` × `depth` meters, centered on the entity. */
export function heightfieldCollider(heights: Float32Array, samples: number, width: number, depth: number, options: ColliderOptions = {}): ColliderData {
  let top = 0
  for (const h of heights) top = Math.max(top, Math.abs(h))
  const data = collider('heightfield', new Vector3(width / 2, top, depth / 2), 0, 0, options)
  data.heights = heights
  data.samples = samples
  return data
}

export type JointType = 'fixed' | 'hinge' | 'ball' | 'slider' | 'spring'

export interface JointData {
  type: JointType
  /** The other body; null attaches to a fixed point in the world. */
  target: Entity | null
  /** Joint point relative to this entity (local units, scale applied). */
  anchor: Vector3
  /** Hinge/slider axis in this entity's local space. */
  axis: Vector3
  /** Hinge (radians) or slider (meters) range; null = free. */
  limits: [number, number] | null
  /** Spring: rest length (meters; < 0 = the distance when created), stiffness and damping. */
  restLength: number
  stiffness: number
  damping: number
  /** Hinge/slider motor: target speed (rad/s or m/s) and strength; 0 strength = no motor. */
  motorSpeed: number
  motorStrength: number
}

/** Connects the entity's rigid body to another body (or the world). Rapier only. */
export const Joint = defineComponent<JointData>('Joint')

export function joint(type: JointType, target: Entity | null, options: Partial<Omit<JointData, 'type' | 'target'>> = {}): JointData {
  return {
    type,
    target,
    anchor: new Vector3(),
    axis: new Vector3(0, 1, 0),
    limits: null,
    restLength: -1,
    stiffness: 50,
    damping: 2,
    motorSpeed: 0,
    motorStrength: 0,
    ...options,
  }
}

export function cylinderCollider(radius: number, halfHeight: number, options: ColliderOptions = {}): ColliderData {
  return collider('cylinder', new Vector3(radius, halfHeight, radius), radius, halfHeight, options)
}
