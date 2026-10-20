import * as THREE from 'three'
import type { Engine, Entity, Input, RigidBodyData, Time } from '../engine'
import { damp, dampAngle, moveTowards, teleport } from '../engine'
import type { ParamValue, ProjectDoc } from './document'

/** A live entity as seen from scripts. */
export interface Handle {
  readonly entity: Entity
  readonly name: string
  readonly object: THREE.Object3D
  readonly body: RigidBodyData | undefined
}

export interface HudApi {
  set(key: string, value: string | number): void
  remove(key: string): void
  /** Big centered message; `null` hides it. */
  message(text: string | null): void
}

export interface ScriptContext<P = Record<string, ParamValue>> extends Handle {
  readonly params: P
  readonly engine: Engine
  readonly input: Input
  readonly time: Time
  /** Per-instance scratch space. */
  readonly state: Record<string, unknown>
  /** Shared by every script in this play session. */
  readonly globals: Record<string, unknown>
  readonly hud: HudApi
  find(name: string): Handle | undefined
  destroy(target?: Handle): void
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/**
 * A script. `params` declares inspector-editable values; their types are
 * inferred from the defaults (number, boolean, string, '#rrggbb' color).
 */
export interface Behavior {
  name: string
  description?: string
  params: Record<string, ParamValue>
  start?(ctx: ScriptContext): void
  fixedUpdate?(ctx: ScriptContext, dt: number): void
  update?(ctx: ScriptContext, dt: number): void
  lateUpdate?(ctx: ScriptContext, dt: number): void
  onCollisionEnter?(ctx: ScriptContext, other: Handle): void
  onCollisionExit?(ctx: ScriptContext, other: Handle): void
  onDestroy?(ctx: ScriptContext): void
}

export const SCRIPT_TEMPLATE = `// Lifecycle: start, fixedUpdate, update, lateUpdate,
// onCollisionEnter(ctx, other), onCollisionExit, onDestroy.
// ctx: object, body, params, input, time, hud, find(name), destroy(), log()
// THREE is available as a global.

export default {
  params: { speed: 90 },

  update(ctx, dt) {
    ctx.object.rotation.y += THREE.MathUtils.degToRad(ctx.params.speed) * dt
  },
}
`

const SCRIPT_HELPERS = { damp, dampAngle, moveTowards, teleport }

const compiled = new Map<string, Behavior | Error>()

/** Compiles project script source (`export default { ... }`). Results are cached by source. */
export function compileScript(name: string, source: string): Behavior | Error {
  const cached = compiled.get(source)
  if (cached) return cached
  let result: Behavior | Error
  try {
    const body = source.replace(/^\s*export\s+default\s+/m, 'return ')
    const factory = new Function('THREE', 'helpers', `"use strict";\n${body}`) as (
      three: typeof THREE,
      helpers: typeof SCRIPT_HELPERS,
    ) => Partial<Behavior> | undefined
    const value = factory(THREE, SCRIPT_HELPERS)
    if (!value || typeof value !== 'object') throw new Error('Script must `export default { ... }`')
    result = { ...value, name, params: value.params ?? {} }
  } catch (error) {
    result = error instanceof Error ? error : new Error(String(error))
  }
  compiled.set(source, result)
  return result
}

export function resolveBehavior(id: string, doc: ProjectDoc): Behavior | Error {
  if (id.startsWith('builtin:')) return BUILTINS[id] ?? new Error(`Unknown built-in ${id}`)
  const script = doc.scripts.find((s) => s.id === id)
  if (!script) return new Error('Missing script')
  return compileScript(script.name, script.source)
}

export function scriptLabel(id: string, doc: ProjectDoc): string {
  if (id.startsWith('builtin:')) return id.slice('builtin:'.length)
  return doc.scripts.find((s) => s.id === id)?.name ?? 'Missing script'
}

// ---------------------------------------------------------------------------
// Built-in behaviors

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

const Rotate: Behavior = {
  name: 'Rotate',
  description: 'Spins the object (degrees per second).',
  params: { x: 0, y: 90, z: 0 },
  update(ctx, dt) {
    const p = ctx.params as { x: number; y: number; z: number }
    const r = ctx.object.rotation
    r.x += THREE.MathUtils.degToRad(p.x) * dt
    r.y += THREE.MathUtils.degToRad(p.y) * dt
    r.z += THREE.MathUtils.degToRad(p.z) * dt
  },
}

const Bob: Behavior = {
  name: 'Bob',
  description: 'Floats up and down.',
  params: { height: 0.15, speed: 2.5 },
  start(ctx) {
    ctx.state.baseY = ctx.object.position.y
    ctx.state.phase = Math.random() * Math.PI * 2
  },
  update(ctx) {
    const p = ctx.params as { height: number; speed: number }
    ctx.object.position.y =
      (ctx.state.baseY as number) + Math.sin(ctx.time.elapsed * p.speed + (ctx.state.phase as number)) * p.height
  },
}

const PlayerController: Behavior = {
  name: 'PlayerController',
  description: 'WASD/stick movement relative to the camera, Space to jump. Needs a Rigid Body.',
  params: { speed: 7, sprintSpeed: 11, jumpSpeed: 10, acceleration: 70, respawnBelow: -15 },
  start(ctx) {
    ctx.state.spawn = ctx.body?.position.clone()
    ctx.state.sinceGrounded = Infinity
    ctx.state.sinceJump = Infinity
    if (!ctx.body) ctx.warn(`${ctx.name}: PlayerController needs a Rigid Body`)
  },
  fixedUpdate(ctx, dt) {
    const body = ctx.body
    if (!body) return
    const p = ctx.params as Record<string, number>
    const { input } = ctx
    const pad = input.gamepad.axes
    const forward = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) - pad[1]
    const strafe = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + pad[0]

    ctx.engine.camera.getWorldDirection(v1)
    v1.y = 0
    if (v1.lengthSq() < 1e-6) v1.set(0, 0, -1)
    v1.normalize()
    v2.crossVectors(v1, UP)
    const wish = v1.multiplyScalar(forward).addScaledVector(v2, strafe)
    if (wish.lengthSq() > 1) wish.normalize()

    const sprint = input.isDown(['ShiftLeft', 'ShiftRight', 'GamepadRB'])
    const speed = sprint ? p.sprintSpeed : p.speed
    const accel = (body.grounded ? p.acceleration : p.acceleration * 0.35) * dt
    body.velocity.x = moveTowards(body.velocity.x, wish.x * speed, accel)
    body.velocity.z = moveTowards(body.velocity.z, wish.z * speed, accel)

    // Coyote time + jump buffering.
    const s = ctx.state as { sinceGrounded: number; sinceJump: number; spawn?: THREE.Vector3 }
    s.sinceGrounded = body.grounded ? 0 : s.sinceGrounded + dt
    s.sinceJump = input.wasPressed(['Space', 'GamepadA']) ? 0 : s.sinceJump + dt
    if (s.sinceJump <= 0.12 && s.sinceGrounded <= 0.12) {
      body.velocity.y = p.jumpSpeed
      s.sinceGrounded = s.sinceJump = Infinity
    }
    if (body.velocity.y > 0 && !input.isDown(['Space', 'GamepadA'])) body.velocity.y *= 0.9

    if (body.position.y < p.respawnBelow && s.spawn) {
      teleport(body, s.spawn)
      body.velocity.set(0, 0, 0)
    }
  },
  update(ctx, dt) {
    const v = ctx.body?.velocity
    if (!v || v.x * v.x + v.z * v.z < 0.5) return
    ctx.object.rotation.y = dampAngle(ctx.object.rotation.y, Math.atan2(-v.x, -v.z), 14, dt)
  },
}

const FollowCamera: Behavior = {
  name: 'FollowCamera',
  description: 'Orbits and follows a target. Drag to look, wheel to zoom. Put it on the camera.',
  params: { target: 'Player', distance: 10, height: 1.2, pitch: 20, smoothing: 10 },
  start(ctx) {
    const p = ctx.params as { distance: number; pitch: number }
    ctx.state.yaw = ctx.object.rotation.y
    ctx.state.pitch = THREE.MathUtils.degToRad(p.pitch)
    ctx.state.distance = p.distance
    ctx.state.focus = new THREE.Vector3()
    ctx.state.initialized = false
  },
  lateUpdate(ctx, dt) {
    const p = ctx.params as { target: string; height: number; smoothing: number }
    const target = ctx.find(p.target)
    if (!target) return
    const s = ctx.state as { yaw: number; pitch: number; distance: number; focus: THREE.Vector3; initialized: boolean }
    const { input } = ctx
    if (input.isDown(['Mouse0', 'Mouse2']) || input.pointer.locked) {
      s.yaw -= input.pointer.dx * 0.005
      s.pitch += input.pointer.dy * 0.004
    }
    s.yaw -= input.gamepad.axes[2] * 2.5 * dt
    s.pitch = THREE.MathUtils.clamp(s.pitch + input.gamepad.axes[3] * 1.8 * dt, -0.1, 1.2)
    s.distance = THREE.MathUtils.clamp(s.distance * (1 + input.pointer.wheel * 0.001), 3, 30)

    target.object.getWorldPosition(v1)
    v1.y += p.height
    if (!s.initialized) {
      s.focus.copy(v1)
      s.initialized = true
    }
    s.focus.set(
      damp(s.focus.x, v1.x, p.smoothing, dt),
      damp(s.focus.y, v1.y, p.smoothing * 0.7, dt),
      damp(s.focus.z, v1.z, p.smoothing, dt),
    )
    const cp = Math.cos(s.pitch)
    ctx.object.position.set(
      s.focus.x + Math.sin(s.yaw) * cp * s.distance,
      Math.max(0.4, s.focus.y + Math.sin(s.pitch) * s.distance),
      s.focus.z + Math.cos(s.yaw) * cp * s.distance,
    )
    // Object3D.lookAt aims +Z at the target; cameras look down -Z, so turn around.
    ctx.object.lookAt(s.focus)
    ctx.object.rotateY(Math.PI)
  },
}

const Collectible: Behavior = {
  name: 'Collectible',
  description: 'Disappears when the target touches it and counts toward a HUD counter. Needs a trigger collider.',
  params: { collector: 'Player', counter: 'Coins', winMessage: 'All collected!' },
  start(ctx) {
    const p = ctx.params as { counter: string }
    const g = ctx.globals as Record<string, number>
    g[`${p.counter}:total`] = (g[`${p.counter}:total`] ?? 0) + 1
    g[`${p.counter}:got`] ??= 0
    ctx.hud.set(p.counter, `${g[`${p.counter}:got`]} / ${g[`${p.counter}:total`]}`)
  },
  onCollisionEnter(ctx, other) {
    const p = ctx.params as { collector: string; counter: string; winMessage: string }
    if (other.name !== p.collector) return
    const g = ctx.globals as Record<string, number>
    const got = ++g[`${p.counter}:got`]
    const total = g[`${p.counter}:total`]
    ctx.hud.set(p.counter, `${got} / ${total}`)
    if (got === total && p.winMessage) ctx.hud.message(p.winMessage)
    ctx.destroy()
  },
}

const DestroyBelow: Behavior = {
  name: 'DestroyBelow',
  description: 'Destroys the entity when it falls below a height.',
  params: { y: -20 },
  update(ctx) {
    ctx.object.getWorldPosition(v1)
    if (v1.y < (ctx.params.y as number)) ctx.destroy()
  },
}

export const BUILTINS: Record<string, Behavior> = Object.fromEntries(
  [Rotate, Bob, PlayerController, FollowCamera, Collectible, DestroyBelow].map((b) => [`builtin:${b.name}`, b]),
)
