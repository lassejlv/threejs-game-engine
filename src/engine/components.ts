import { type Object3D, Quaternion, Vector3 } from 'three'
import { defineComponent } from './ecs/component'

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

export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder'

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

export function cylinderCollider(radius: number, halfHeight: number, options: ColliderOptions = {}): ColliderData {
  return collider('cylinder', new Vector3(radius, halfHeight, radius), radius, halfHeight, options)
}
