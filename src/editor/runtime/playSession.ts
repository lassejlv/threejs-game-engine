import { Audio, type AudioListener, Object3D, PositionalAudio } from 'three'
import { defineComponent, type Engine, type Entity, type RapierPhysics, type System } from '../../engine'
import { log } from '../console'
import type { Animator } from './animator'
import type { ParticleEmitter } from './particles'
import { GameUi } from './gameUi'
import type { EntityDoc, ParamValue, ProjectDoc } from '../document'
import {
  type AudioSourceApi,
  type Behavior,
  type Handle,
  type HudApi,
  type PhysicsApi,
  compileScript,
  resolveBehavior,
  type ScriptContext,
  type SoundApi,
  type SpawnOptions,
} from '../scripting'
import type { AssetResolver } from './nodes'

interface Instance {
  /** `builtin:Name` or a project script id. */
  scriptId: string
  /** Inspector overrides, reapplied when the script hot-reloads with new params. */
  overrides: Record<string, ParamValue>
  behavior: Behavior
  ctx: ScriptContext
  started: boolean
  failed: boolean
}

const Scripts = defineComponent<Instance[]>('Scripts')

/** Running sessions, so the editor can hot-reload scripts saved during play. */
export const activeSessions = new Set<PlaySession>()

type Lifecycle = 'fixedUpdate' | 'update' | 'lateUpdate'

/** Scene-level services the session can't build itself. */
export interface SessionRuntime {
  sceneName: string
  spawn(prefab: string, options: SpawnOptions): Handle | undefined
  loadScene(name: string): void
}

/** Runs entity scripts for one play session. */
export class PlaySession {
  readonly globals: Record<string, unknown> = {}
  private runtime: SessionRuntime = { sceneName: '', spawn: () => undefined, loadScene: () => {} }
  private pendingScene: string | null = null
  private readonly handles = new Map<Entity, Handle>()
  private readonly byName = new Map<string, Entity[]>()
  private readonly children = new Map<Entity, Entity[]>()
  private readonly ui: GameUi
  private readonly hud: HudApi
  private readonly sound: SoundApi
  private readonly oneShots = new Set<Audio | PositionalAudio>()

  constructor(
    private readonly engine: Engine,
    private readonly doc: ProjectDoc,
    private readonly rapier: RapierPhysics,
    private readonly listener: AudioListener,
    private readonly assets: AssetResolver,
  ) {
    this.ui = new GameUi(engine.container, (fn) => {
      try {
        fn()
      } catch (error) {
        log('error', 'UI callback threw:', describe(error))
      }
    })
    this.sound = {
      play: (name, options = {}) => this.playOneShot(name, options.volume ?? 1, options.at),
      tone: (frequency, duration = 0.15, options = {}) => {
        const context = this.listener.context
        const start = context.currentTime + (options.delay ?? 0)
        const osc = context.createOscillator()
        const gain = context.createGain()
        osc.type = options.type ?? 'sine'
        osc.frequency.value = frequency
        gain.gain.setValueAtTime(options.volume ?? 0.2, start)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        osc.connect(gain).connect(this.listener.getInput())
        osc.start(start)
        osc.stop(start + duration + 0.02)
      },
    }
    this.hud = {
      set: (key, value) => this.ui.setStat(key, value),
      remove: (key) => this.ui.removeStat(key),
      message: (text) => this.ui.message(text),
    }
  }

  connect(runtime: SessionRuntime): void {
    this.runtime = runtime
  }

  handle(entity: Entity): Handle | undefined {
    return this.handles.get(entity)
  }

  register(handle: Handle, parent: Entity | null): void {
    this.handles.set(handle.entity, handle)
    const named = this.byName.get(handle.name) ?? []
    named.push(handle.entity)
    this.byName.set(handle.name, named)
    if (parent !== null) {
      const list = this.children.get(parent) ?? []
      list.push(handle.entity)
      this.children.set(parent, list)
    }
  }

  attachScripts(handle: Handle, entity: EntityDoc): void {
    const instances: Instance[] = []
    for (const ref of entity.scripts) {
      const behavior = resolveBehavior(ref.script, this.doc)
      if (behavior instanceof Error) {
        log('error', `"${entity.name}": script failed to compile: ${behavior.message}`)
        continue
      }
      instances.push({
        scriptId: ref.script,
        overrides: ref.params,
        behavior,
        ctx: this.context(handle, behavior, ref.params),
        started: false,
        failed: false,
      })
    }
    if (instances.length) this.engine.world.add(handle.entity, Scripts, instances)
  }

  systems(): System[] {
    const run = (phase: Lifecycle) => (_engine: Engine, dt: number) => this.runAll(phase, dt)
    return [
      {
        name: 'scripts.fixedUpdate',
        phase: 'fixed',
        order: -50, // before physics integrates
        run: run('fixedUpdate'),
        init: (engine) => {
          activeSessions.add(this)
          const offEnter = engine.events.on('collisionEnter', ({ a, b }) => this.collision('onCollisionEnter', a, b))
          const offExit = engine.events.on('collisionExit', ({ a, b }) => this.collision('onCollisionExit', a, b))
          return () => {
            activeSessions.delete(this)
            offEnter()
            offExit()
            this.ui.dispose()
            for (const sound of this.oneShots) if (sound.isPlaying) sound.stop()
            this.listener.removeFromParent()
          }
        },
      },
      { name: 'scripts.update', phase: 'update', run: run('update') },
      { name: 'scripts.lateUpdate', phase: 'late', run: run('lateUpdate') },
      {
        name: 'ui.labels',
        phase: 'render',
        run: (engine) => {
          // The listener rides on whichever camera is active (game or editor view).
          if (this.listener.parent !== engine.camera) engine.camera.add(this.listener)
          this.ui.update(engine.camera, (h) => engine.world.isAlive(h.entity))
        },
      },
      {
        // Scene switches wait until the frame is done so no script runs against a torn-down world.
        name: 'scripts.sceneSwitch',
        phase: 'render',
        run: () => {
          const next = this.pendingScene
          this.pendingScene = null
          if (next !== null) this.runtime.loadScene(next)
        },
      },
    ]
  }

  /** Swaps in a new version of a script for every running instance, keeping their state. */
  reloadScript(scriptId: string, name: string, source: string): void {
    const behavior = compileScript(name, source)
    if (behavior instanceof Error) {
      log('error', `${name}: compile error, keeping the running version: ${behavior.message}`)
      return
    }
    let count = 0
    for (const instances of this.engine.world.store(Scripts).values) {
      for (const instance of instances) {
        if (instance.scriptId !== scriptId) continue
        instance.behavior = behavior
        instance.failed = false
        const params = instance.ctx.params as Record<string, ParamValue>
        for (const key in behavior.params) {
          if (!(key in params)) params[key] = key in instance.overrides ? instance.overrides[key] : behavior.params[key]
        }
        count++
      }
    }
    log('log', `Hot-reloaded ${name} (${count} instance${count === 1 ? '' : 's'})`)
  }

  private context(handle: Handle, behavior: Behavior, overrides: Record<string, ParamValue>): ScriptContext {
    const params: Record<string, ParamValue> = {}
    for (const key in behavior.params) params[key] = key in overrides ? overrides[key] : behavior.params[key]
    const prefix = `[${handle.name}]`
    const session = this
    const physics: PhysicsApi = {
      raycast: (origin, direction, maxDistance, options = {}) => {
        const hit = this.rapier.raycast(origin, direction, maxDistance, {
          exclude: options.ignoreSelf === false ? undefined : handle.entity,
          triggers: options.triggers,
        })
        const target = hit && this.handles.get(hit.entity)
        return hit && target ? { handle: target, point: hit.point, normal: hit.normal, distance: hit.distance } : null
      },
      applyImpulse: (target, impulse) => this.rapier.applyImpulse(target.entity, impulse),
      addForce: (target, force) => this.rapier.addForce(target.entity, force),
      addTorque: (target, torque) => this.rapier.addTorque(target.entity, torque),
      applyTorqueImpulse: (target, impulse) => this.rapier.applyTorqueImpulse(target.entity, impulse),
      angularVelocity: (target) => this.rapier.angularVelocity(target.entity),
      setAngularVelocity: (target, velocity) => this.rapier.setAngularVelocity(target.entity, velocity),
      overlap: (center, size, options = {}) =>
        this.rapier
          .overlap(center, size, { exclude: options.ignoreSelf === false ? undefined : handle.entity, triggers: options.triggers })
          .flatMap((entity) => this.handles.get(entity) ?? []),
      sphereCast: (origin, radius, direction, maxDistance, options = {}) => {
        const hit = this.rapier.sphereCast(origin, radius, direction, maxDistance, {
          exclude: options.ignoreSelf === false ? undefined : handle.entity,
          triggers: options.triggers,
        })
        const target = hit && this.handles.get(hit.entity)
        return hit && target ? { handle: target, point: hit.point, normal: hit.normal, distance: hit.distance } : null
      },
    }
    return {
      ...handle,
      params,
      engine: this.engine,
      input: this.engine.input,
      time: this.engine.time,
      state: {},
      globals: this.globals,
      hud: this.hud,
      ui: this.ui.api,
      physics,
      sound: this.sound,
      audio: audioApi(handle.object.userData.audio as Audio | undefined),
      animation: handle.object.userData.animator as Animator | undefined,
      particles: handle.object.userData.particles as ParticleEmitter | undefined,
      get sceneName() {
        return session.runtime.sceneName
      },
      spawn: (prefab, options = {}) => this.runtime.spawn(prefab, options),
      loadScene: (name) => {
        this.pendingScene = name
      },
      find: (name) => {
        const entity = this.byName.get(name)?.find((e) => this.engine.world.isAlive(e))
        return entity === undefined ? undefined : this.handles.get(entity)
      },
      destroy: (target = handle) => this.destroy(target.entity),
      log: (...args) => log('log', prefix, ...args),
      warn: (...args) => log('warn', prefix, ...args),
      error: (...args) => log('error', prefix, ...args),
    }
  }

  private playOneShot(name: string, volume: number, at?: { x: number; y: number; z: number }): void {
    const id = this.assets.byName(name)
    const url = id && this.assets.url(id)
    if (!url) {
      log('warn', `sound.play: no audio asset named "${name}"`)
      return
    }
    const sound = at ? new PositionalAudio(this.listener) : new Audio(this.listener)
    const holder = new Object3D()
    if (at) holder.position.set(at.x, at.y, at.z)
    holder.add(sound)
    this.engine.scene.add(holder)
    sound.setVolume(volume)
    this.oneShots.add(sound)
    void this.engine.assets.audio(url).then((buffer) => {
      if (!holder.parent) return
      sound.setBuffer(buffer)
      sound.onEnded = () => {
        ;(sound as { isPlaying: boolean }).isPlaying = false
        this.oneShots.delete(sound)
        holder.removeFromParent()
      }
      sound.play()
    })
  }

  private runAll(phase: Lifecycle, dt: number): void {
    const { world } = this.engine
    const store = world.store(Scripts)
    // Iterate a snapshot: scripts may destroy entities or spawn new ones.
    const entities = [...store.dense]
    for (const entity of entities) {
      if (!world.isAlive(entity)) continue
      const instances = store.get(entity)
      if (!instances) continue
      for (const instance of instances) {
        const fn = instance.behavior[phase]
        if (!this.ensureStarted(instance) || !fn) continue
        this.guard(instance, () => fn.call(instance.behavior, instance.ctx, dt))
      }
    }
  }

  private collision(hook: 'onCollisionEnter' | 'onCollisionExit', a: Entity, b: Entity): void {
    this.notify(hook, a, b)
    this.notify(hook, b, a)
  }

  private notify(hook: 'onCollisionEnter' | 'onCollisionExit', self: Entity, other: Entity): void {
    const { world } = this.engine
    if (!world.isAlive(self)) return
    const instances = world.tryGet(self, Scripts)
    const otherHandle = this.handles.get(other)
    if (!instances || !otherHandle) return
    for (const instance of instances) {
      const fn = instance.behavior[hook]
      if (fn && this.ensureStarted(instance)) this.guard(instance, () => fn.call(instance.behavior, instance.ctx, otherHandle))
    }
  }

  /** Destroys the entity and its children, running their scripts' onDestroy. */
  destroy(entity: Entity): void {
    const { world } = this.engine
    if (!world.isAlive(entity)) return
    for (const child of this.children.get(entity) ?? []) this.destroy(child)
    for (const instance of world.tryGet(entity, Scripts) ?? []) {
      const fn = instance.behavior.onDestroy
      if (fn && instance.started) this.guard(instance, () => fn.call(instance.behavior, instance.ctx))
    }
    world.destroy(entity)
  }

  private ensureStarted(instance: Instance): boolean {
    if (instance.failed) return false
    if (!instance.started) {
      instance.started = true
      const start = instance.behavior.start
      if (start) this.guard(instance, () => start.call(instance.behavior, instance.ctx))
    }
    return !instance.failed
  }

  /** A throwing script is disabled and reported; the game keeps running. */
  private guard(instance: Instance, fn: () => void): void {
    try {
      fn()
    } catch (error) {
      instance.failed = true
      log('error', `${instance.behavior.name} on "${instance.ctx.name}" threw and was disabled: ${describe(error)}`)
    }
  }
}

/** Error message plus the line in the user's script (project scripts run via `new Function`). */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  // `new Function` adds two header lines and compileScript adds "use strict".
  const match = error.stack?.match(/<anonymous>:(\d+):(\d+)/)
  return match ? `${error.message} (line ${Number(match[1]) - 3})` : error.message
}

function audioApi(sound: Audio | undefined): AudioSourceApi | undefined {
  if (!sound) return undefined
  return {
    play: () => {
      if (sound.buffer) {
        if (sound.isPlaying) sound.stop()
        sound.play()
      }
    },
    stop: () => {
      if (sound.isPlaying) sound.stop()
    },
    setVolume: (volume) => sound.setVolume(volume),
    get playing() {
      return sound.isPlaying
    },
  }
}
