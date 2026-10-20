import * as THREE from 'three'
import type { Engine, Entity, Input, RigidBodyData, Time } from '../engine'
import { damp, dampAngle, moveTowards, teleport } from '../engine'
import type { ParamValue, ProjectDoc } from './document'
import type { AnimationApi } from './runtime/animator'
import type { NavApi } from './runtime/navigation'
import type { ParticlesApi } from './runtime/particles'
import type { TimerHandle, TweenOptions } from './runtime/timers'
import type { UiApi } from './runtime/gameUi'

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

export interface PhysicsHit {
  handle: Handle
  point: THREE.Vector3
  normal: THREE.Vector3
  distance: number
}

export interface PhysicsApi {
  /** Casts a ray (ignores the caster and triggers by default). */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance?: number,
    options?: { triggers?: boolean; ignoreSelf?: boolean },
  ): PhysicsHit | null
  /** Instant velocity change scaled by mass (dynamic bodies only). */
  applyImpulse(target: Handle, impulse: THREE.Vector3): void
  /** Pushes a dynamic body for this step; call it every fixedUpdate for a steady push. */
  addForce(target: Handle, force: THREE.Vector3): void
  /** Spins a dynamic body for this step; call it every fixedUpdate. */
  addTorque(target: Handle, torque: THREE.Vector3): void
  /** Instant spin change scaled by inertia. */
  applyTorqueImpulse(target: Handle, impulse: THREE.Vector3): void
  /** Radians per second around each world axis. */
  angularVelocity(target: Handle): THREE.Vector3
  setAngularVelocity(target: Handle, velocity: THREE.Vector3): void
  /** Entities touching a sphere (radius) or box (half extents) at a point. Ignores the caller and triggers by default. */
  overlap(center: THREE.Vector3, size: number | THREE.Vector3, options?: { triggers?: boolean; ignoreSelf?: boolean }): Handle[]
  /** Sweeps a sphere along a direction: like a raycast with thickness. */
  sphereCast(
    origin: THREE.Vector3,
    radius: number,
    direction: THREE.Vector3,
    maxDistance?: number,
    options?: { triggers?: boolean; ignoreSelf?: boolean },
  ): PhysicsHit | null
}

export interface SoundApi {
  /** One-shot sound from an audio asset (by file name). `at` makes it 3D. */
  play(asset: string, options?: { volume?: number; at?: THREE.Vector3Like }): void
  /** Synthesized beep: handy for prototyping without audio files. */
  tone(frequency: number, duration?: number, options?: { type?: OscillatorType; volume?: number; delay?: number }): void
}

/** The entity's own Audio Source component. */
export interface AudioSourceApi {
  play(): void
  stop(): void
  setVolume(volume: number): void
  readonly playing: boolean
}

export interface SpawnOptions {
  position?: THREE.Vector3Like
  /** Euler angles in degrees. */
  rotation?: THREE.Vector3Like
  parent?: Handle
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
  /** Screen-space UI: text, buttons, bars and world labels. */
  readonly ui: UiApi
  readonly physics: PhysicsApi
  readonly sound: SoundApi
  /** Present when the entity has an Audio Source. */
  readonly audio: AudioSourceApi | undefined
  /** Present when the entity has a Model; controls its glTF animation clips. */
  readonly animation: AnimationApi | undefined
  /** Present when the entity has a Particle Emitter. */
  readonly particles: ParticlesApi | undefined
  /** Pathfinding over the scene's static geometry. */
  readonly nav: NavApi
  /** Name of the running scene. */
  readonly sceneName: string
  find(name: string): Handle | undefined
  /** Creates an instance of a prefab (by name). Its scripts start next frame. */
  spawn(prefab: string, options?: SpawnOptions): Handle | undefined
  /** Switches to another scene (by name) after this frame. */
  loadScene(name: string): void
  destroy(target?: Handle): void
  /** Calls `fn` once after `seconds` of game time. Cancelled if this entity is destroyed. */
  after(seconds: number, fn: () => void): TimerHandle
  /** Calls `fn` every `seconds` until cancelled or this entity is destroyed. */
  every(seconds: number, fn: () => void): TimerHandle
  /** Animates numeric properties, e.g. `ctx.tween(ctx.object.position, { y: 3 }, 0.5, { ease: 'backOut' })`. */
  tween<T extends object>(target: T, to: Partial<Record<keyof T, number>>, duration: number, options?: TweenOptions): TimerHandle
  /** Listens for an event from any script; returns a function that stops listening. */
  on(name: string, fn: (data: any) => void): () => void
  /** Sends an event to every listener right away. */
  emit(name: string, data?: unknown): void
  /** Stores a JSON value in the browser that survives reloads (high scores, progress). */
  save(key: string, value: unknown): void
  load<T>(key: string, fallback: T): T
  deleteSave(key: string): void
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
// Type "ctx." for everything a script can do. THREE is a global.

/** @type {import('engine').Script} */
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
const DOWN = new THREE.Vector3(0, -1, 0)

/** Sends a body back to the last checkpoint (set by the Checkpoint script) or to `fallback`. */
function respawn(ctx: ScriptContext, fallback: THREE.Vector3 | undefined): void {
  const point = (ctx.globals.checkpoint as THREE.Vector3 | undefined) ?? fallback
  if (!point) return
  if (ctx.body) {
    teleport(ctx.body, point)
    ctx.body.velocity.set(0, 0, 0)
  } else ctx.object.position.copy(point)
}

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
    // Named bindings from Project Settings → Input, so players can remap them.
    const forward = input.getAxis('MoveY')
    const strafe = input.getAxis('MoveX')

    ctx.engine.camera.getWorldDirection(v1)
    v1.y = 0
    if (v1.lengthSq() < 1e-6) v1.set(0, 0, -1)
    v1.normalize()
    v2.crossVectors(v1, UP)
    const wish = v1.multiplyScalar(forward).addScaledVector(v2, strafe)
    if (wish.lengthSq() > 1) wish.normalize()

    const sprint = input.action('Sprint')
    const speed = sprint ? p.sprintSpeed : p.speed
    const accel = (body.grounded ? p.acceleration : p.acceleration * 0.35) * dt
    body.velocity.x = moveTowards(body.velocity.x, wish.x * speed, accel)
    body.velocity.z = moveTowards(body.velocity.z, wish.z * speed, accel)

    // Coyote time + jump buffering.
    const s = ctx.state as { sinceGrounded: number; sinceJump: number; spawn?: THREE.Vector3 }
    s.sinceGrounded = body.grounded ? 0 : s.sinceGrounded + dt
    s.sinceJump = input.actionPressed('Jump') ? 0 : s.sinceJump + dt
    if (s.sinceJump <= 0.12 && s.sinceGrounded <= 0.12) {
      body.velocity.y = p.jumpSpeed
      s.sinceGrounded = s.sinceJump = Infinity
    }
    if (body.velocity.y > 0 && !input.action('Jump')) body.velocity.y *= 0.9

    // Ride kinematic platforms: move along with whatever kinematic body is underfoot.
    if (body.grounded) {
      const ground = ctx.physics.raycast(v1.copy(body.position), DOWN, 2.5)
      const carrier = ground?.handle.body
      if (carrier?.kinematic) body.position.addScaledVector(carrier.velocity, dt)
    }

    if (body.position.y < p.respawnBelow) respawn(ctx, s.spawn)
  },
  update(ctx, dt) {
    const v = ctx.body?.velocity
    // Parameters for an animation state machine on the player's model.
    if (ctx.animation && v) {
      ctx.animation.set('speed', Math.hypot(v.x, v.z))
      ctx.animation.set('verticalSpeed', v.y)
      ctx.animation.set('grounded', ctx.body?.grounded ?? true)
    }
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
    s.yaw -= input.getAxis('LookX') * 2.5 * dt
    s.pitch = THREE.MathUtils.clamp(s.pitch + input.getAxis('LookY') * 1.8 * dt, -0.1, 1.2)
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
  description:
    'Disappears when the target touches it and counts toward a HUD counter. Needs a trigger collider. Effect: a prefab spawned where it was collected.',
  params: { collector: 'Player', counter: 'Coins', winMessage: 'All collected!', sound: '', effect: '' },
  start(ctx) {
    const p = ctx.params as { counter: string }
    const g = ctx.globals as Record<string, number>
    g[`${p.counter}:total`] = (g[`${p.counter}:total`] ?? 0) + 1
    g[`${p.counter}:got`] ??= 0
    ctx.hud.set(p.counter, `${g[`${p.counter}:got`]} / ${g[`${p.counter}:total`]}`)
  },
  onCollisionEnter(ctx, other) {
    const p = ctx.params as { collector: string; counter: string; winMessage: string; sound: string; effect: string }
    if (other.name !== p.collector) return
    const g = ctx.globals as Record<string, number>
    const got = ++g[`${p.counter}:got`]
    const total = g[`${p.counter}:total`]
    ctx.hud.set(p.counter, `${got} / ${total}`)
    if (got === total && p.winMessage) ctx.hud.message(p.winMessage)
    // An audio asset name, or a synthesized two-note chime when empty.
    if (p.sound) ctx.sound.play(p.sound)
    else {
      ctx.sound.tone(988, 0.07, { type: 'square', volume: 0.12 })
      ctx.sound.tone(1319, 0.2, { type: 'square', volume: 0.12, delay: 0.07 })
    }
    if (p.effect) ctx.spawn(p.effect, { position: ctx.object.getWorldPosition(v1) })
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

const MovingPlatform: Behavior = {
  name: 'MovingPlatform',
  description: 'Moves back and forth by an offset (meters), pausing at each end. Use a kinematic Rigid Body so it carries players and pushes boxes.',
  params: { x: 0, y: 3, z: 0, duration: 2, wait: 0.5 },
  start(ctx) {
    ctx.state.from = (ctx.body?.position ?? ctx.object.position).clone()
    ctx.state.t = 0
    ctx.state.dir = 1
    ctx.state.pause = 0
  },
  fixedUpdate(ctx, dt) {
    const p = ctx.params as { x: number; y: number; z: number; duration: number; wait: number }
    const s = ctx.state as { from: THREE.Vector3; t: number; dir: number; pause: number }
    if (s.pause > 0) s.pause -= dt
    else {
      s.t += (s.dir * dt) / Math.max(0.05, p.duration)
      if (s.t >= 1 || s.t <= 0) {
        s.t = THREE.MathUtils.clamp(s.t, 0, 1)
        s.dir = -s.dir
        s.pause = p.wait
      }
    }
    const k = THREE.MathUtils.smoothstep(s.t, 0, 1)
    const target = v1.set(p.x, p.y, p.z).multiplyScalar(k).add(s.from)
    // Kinematic bodies move by velocity, so whatever stands on them can follow.
    if (ctx.body) ctx.body.velocity.copy(target).sub(ctx.body.position).divideScalar(dt)
    else ctx.object.position.copy(target)
  },
}

const Patrol: Behavior = {
  name: 'Patrol',
  description: 'Walks back and forth along its local X or Z axis, facing where it goes. Works with or without a character Rigid Body.',
  params: { distance: 6, speed: 2.5, axis: 'x', wait: 0.4 },
  start(ctx) {
    ctx.state.from = (ctx.body?.position ?? ctx.object.position).clone()
    ctx.state.dir = 1
    ctx.state.pause = 0
    const p = ctx.params as { axis: string }
    ctx.state.direction = new THREE.Vector3(p.axis === 'z' ? 0 : 1, 0, p.axis === 'z' ? 1 : 0).applyQuaternion(ctx.object.quaternion).setY(0).normalize()
  },
  fixedUpdate(ctx, dt) {
    const p = ctx.params as { distance: number; speed: number; wait: number }
    const s = ctx.state as { from: THREE.Vector3; dir: number; pause: number; direction: THREE.Vector3 }
    const position = ctx.body?.position ?? ctx.object.position
    const along = v1.copy(position).sub(s.from).dot(s.direction)
    if (s.pause > 0) {
      s.pause -= dt
      if (ctx.body) ctx.body.velocity.x = ctx.body.velocity.z = 0
      return
    }
    if ((s.dir > 0 && along >= p.distance) || (s.dir < 0 && along <= 0)) {
      s.dir = -s.dir
      s.pause = p.wait
      return
    }
    const step = v2.copy(s.direction).multiplyScalar(s.dir * p.speed)
    if (ctx.body) {
      ctx.body.velocity.x = step.x
      ctx.body.velocity.z = step.z
    } else ctx.object.position.addScaledVector(step, dt)
  },
  update(ctx, dt) {
    const s = ctx.state as { dir: number; direction: THREE.Vector3 }
    if (!s.direction) return
    const facing = Math.atan2(-s.direction.x * s.dir, -s.direction.z * s.dir)
    ctx.object.rotation.y = dampAngle(ctx.object.rotation.y, facing, 10, dt)
  },
}

const Health: Behavior = {
  name: 'Health',
  description:
    'Hit points. Other scripts hurt it with ctx.emit("damage", { target, amount }) (see Hazard). On death it respawns at the last checkpoint or is destroyed.',
  params: { max: 3, invincibleTime: 0.8, respawn: false, hud: '' },
  start(ctx) {
    const p = ctx.params as { max: number; invincibleTime: number; respawn: boolean; hud: string }
    const s = ctx.state as { hp: number; safe: number; spawn?: THREE.Vector3 }
    s.hp = p.max
    s.safe = 0
    s.spawn = (ctx.body?.position ?? ctx.object.position).clone()
    const show = () => p.hud && ctx.hud.set(p.hud, `${'♥'.repeat(Math.max(0, s.hp))}${'♡'.repeat(Math.max(0, p.max - s.hp))}`)
    show()
    const isMe = (target: unknown) =>
      (target as Handle | undefined)?.entity === ctx.entity || target === ctx.name
    ctx.on('heal', (data: { target: unknown; amount?: number }) => {
      if (!isMe(data?.target)) return
      s.hp = Math.min(p.max, s.hp + (data.amount ?? 1))
      show()
    })
    ctx.on('damage', (data: { target: unknown; amount?: number }) => {
      if (!isMe(data?.target) || s.safe > 0) return
      s.hp -= data.amount ?? 1
      s.safe = p.invincibleTime
      show()
      if (s.hp > 0) return
      ctx.emit('died', { target: ctx })
      if (p.respawn) {
        respawn(ctx, s.spawn)
        s.hp = p.max
        show()
      } else ctx.destroy()
    })
  },
  update(ctx, dt) {
    const s = ctx.state as { safe: number }
    if (s.safe > 0) {
      s.safe -= dt
      // Blink while invincible.
      ctx.object.visible = s.safe <= 0 || Math.floor(s.safe * 12) % 2 === 0
    }
  },
}

const Hazard: Behavior = {
  name: 'Hazard',
  description: 'Damages whatever touches it (anything with a Health script, or only the named target) and knocks it back.',
  params: { damage: 1, target: '', knockback: 8 },
  onCollisionEnter(ctx, other) {
    const p = ctx.params as { damage: number; target: string; knockback: number }
    if (p.target && other.name !== p.target) return
    ctx.emit('damage', { target: other, amount: p.damage, from: ctx })
    if (other.body && p.knockback > 0) {
      const away = v1.copy(other.body.position).sub(ctx.object.getWorldPosition(v2)).setY(0)
      if (away.lengthSq() < 1e-6) away.set(0, 0, 1)
      away.normalize().multiplyScalar(p.knockback)
      other.body.velocity.set(away.x, p.knockback * 0.6, away.z)
    }
  },
}

const Checkpoint: Behavior = {
  name: 'Checkpoint',
  description: 'When the player touches it, falling or dying respawns them here. Needs a trigger collider.',
  params: { player: 'Player', message: 'Checkpoint!' },
  onCollisionEnter(ctx, other) {
    const p = ctx.params as { player: string; message: string }
    if (other.name !== p.player || ctx.globals.checkpointId === ctx.entity) return
    ctx.globals.checkpointId = ctx.entity
    ctx.globals.checkpoint = ctx.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0))
    ctx.sound.tone(660, 0.08, { type: 'triangle', volume: 0.15 })
    ctx.sound.tone(990, 0.15, { type: 'triangle', volume: 0.15, delay: 0.08 })
    if (p.message) {
      ctx.hud.message(p.message)
      ctx.after(1.2, () => ctx.hud.message(null))
    }
  },
}

const Door: Behavior = {
  name: 'Door',
  description:
    'Opens when the opener comes close, or when they press an action nearby (e.g. Interact). Swings by an angle (put it on a hinge entity with the door as a child) and/or slides up.',
  params: { opener: 'Player', distance: 3, action: '', angle: 90, slide: 0, speed: 4 },
  start(ctx) {
    ctx.state.baseAngle = ctx.object.rotation.y
    ctx.state.baseY = ctx.object.position.y
    ctx.state.open = 0
    ctx.state.toggled = false
  },
  update(ctx, dt) {
    const p = ctx.params as { opener: string; distance: number; action: string; angle: number; slide: number; speed: number }
    const s = ctx.state as { baseAngle: number; baseY: number; open: number; toggled: boolean }
    const opener = ctx.find(p.opener)
    const near = opener ? opener.object.getWorldPosition(v1).distanceTo(ctx.object.getWorldPosition(v2)) < p.distance : false
    if (p.action) {
      if (near && ctx.input.actionPressed(p.action)) s.toggled = !s.toggled
    }
    const want = p.action ? (s.toggled ? 1 : 0) : near ? 1 : 0
    s.open = damp(s.open, want, p.speed, dt)
    ctx.object.rotation.y = s.baseAngle + THREE.MathUtils.degToRad(p.angle) * s.open
    ctx.object.position.y = s.baseY + p.slide * s.open
  },
}

const Chase: Behavior = {
  name: 'Chase',
  description: 'Walks after the target along walkable ground (pathfinding) once it comes within range, and gives up when it gets away.',
  params: { target: 'Player', range: 12, giveUp: 20, speed: 3.5, stopAt: 1.2 },
  update(ctx) {
    const p = ctx.params as { target: string; range: number; giveUp: number; speed: number; stopAt: number }
    const target = ctx.find(p.target)
    if (!target) return
    const distance = target.object.getWorldPosition(v1).distanceTo(ctx.object.getWorldPosition(v2))
    if (!ctx.nav.moving && distance < p.range) ctx.nav.moveTo(target, { speed: p.speed, stoppingDistance: p.stopAt })
    else if (ctx.nav.moving && distance > p.giveUp) ctx.nav.stop()
  },
}

const Wander: Behavior = {
  name: 'Wander',
  description: 'Strolls to random walkable points nearby, pausing in between (pathfinding).',
  params: { radius: 8, speed: 2, pause: 1.5 },
  start(ctx) {
    ctx.state.home = ctx.object.getWorldPosition(new THREE.Vector3())
    ctx.state.wait = Math.random() * 1.5
  },
  update(ctx, dt) {
    const p = ctx.params as { radius: number; speed: number; pause: number }
    const s = ctx.state as { home: THREE.Vector3; wait: number }
    if (ctx.nav.moving) return
    s.wait -= dt
    if (s.wait > 0) return
    s.wait = p.pause
    const grid = ctx.nav.randomPoint(p.radius)
    if (grid && grid.distanceTo(s.home) <= p.radius * 1.5) ctx.nav.moveTo(grid, { speed: p.speed })
  },
}

export const BUILTINS: Record<string, Behavior> = Object.fromEntries(
  [Rotate, Bob, PlayerController, FollowCamera, Collectible, DestroyBelow, MovingPlatform, Patrol, Health, Hazard, Checkpoint, Door, Chase, Wander].map(
    (b) => [`builtin:${b.name}`, b],
  ),
)
