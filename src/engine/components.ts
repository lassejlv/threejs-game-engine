import { type Object3D, Vector3 } from 'three'
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
  velocity: Vector3
  gravityScale: number
  /** Linear damping per second. */
  damping: number
  /** Bounciness on contact, 0..1. */
  restitution: number
  /** Moved by code only: not affected by gravity or pushed by collisions. */
  kinematic: boolean
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
    velocity: new Vector3(),
    gravityScale: 1,
    damping: 0,
    restitution: 0,
    kinematic: false,
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

export interface ColliderData {
  shape: 'box' | 'sphere'
  /** Box half size (axis aligned; rotation is ignored). */
  halfExtents: Vector3
  /** Sphere radius. */
  radius: number
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

type ColliderOptions = Partial<Omit<ColliderData, 'shape' | 'halfExtents' | 'radius'>>

export function boxCollider(halfX: number, halfY: number, halfZ: number, options: ColliderOptions = {}): ColliderData {
  return {
    shape: 'box',
    halfExtents: new Vector3(halfX, halfY, halfZ),
    radius: 0,
    offset: new Vector3(),
    trigger: false,
    layer: 1,
    mask: 0xffffffff,
    ...options,
  }
}

export function sphereCollider(radius: number, options: ColliderOptions = {}): ColliderData {
  return {
    shape: 'sphere',
    halfExtents: new Vector3(radius, radius, radius),
    radius,
    offset: new Vector3(),
    trigger: false,
    layer: 1,
    mask: 0xffffffff,
    ...options,
  }
}
