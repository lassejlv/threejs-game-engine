import { defineComponent, type Engine, type Entity, type RapierPhysics, type System } from '../../engine'
import { log } from '../console'
import { GameUi } from './gameUi'
import type { EntityDoc, ParamValue, ProjectDoc } from '../document'
import { type Behavior, type Handle, type HudApi, type PhysicsApi, resolveBehavior, type ScriptContext, type SpawnOptions } from '../scripting'

interface Instance {
  behavior: Behavior
  ctx: ScriptContext
  started: boolean
  failed: boolean
}

const Scripts = defineComponent<Instance[]>('Scripts')

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

  constructor(
    private readonly engine: Engine,
    private readonly doc: ProjectDoc,
    private readonly rapier: RapierPhysics,
  ) {
    this.ui = new GameUi(engine.container, (fn) => {
      try {
        fn()
      } catch (error) {
        log('error', 'UI callback threw:', describe(error))
      }
    })
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
      instances.push({ behavior, ctx: this.context(handle, behavior, ref.params), started: false, failed: false })
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
          const offEnter = engine.events.on('collisionEnter', ({ a, b }) => this.collision('onCollisionEnter', a, b))
          const offExit = engine.events.on('collisionExit', ({ a, b }) => this.collision('onCollisionExit', a, b))
          return () => {
            offEnter()
            offExit()
            this.ui.dispose()
          }
        },
      },
      { name: 'scripts.update', phase: 'update', run: run('update') },
      { name: 'scripts.lateUpdate', phase: 'late', run: run('lateUpdate') },
      {
        name: 'ui.labels',
        phase: 'render',
        run: (engine) => this.ui.update(engine.camera, (h) => engine.world.isAlive(h.entity)),
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

  private destroy(entity: Entity): void {
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
