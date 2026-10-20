import { createStore, defineComponent, type Engine, type Entity, type System } from '../../engine'
import { log } from '../console'
import type { EntityDoc, ParamValue, ProjectDoc } from '../document'
import { type Behavior, type Handle, type HudApi, resolveBehavior, type ScriptContext } from '../scripting'

export const hudStore = createStore({
  values: {} as Record<string, string | number>,
  message: null as string | null,
})

interface Instance {
  behavior: Behavior
  ctx: ScriptContext
  started: boolean
  failed: boolean
}

const Scripts = defineComponent<Instance[]>('Scripts')

type Lifecycle = 'fixedUpdate' | 'update' | 'lateUpdate'

/** Runs entity scripts for one play session. */
export class PlaySession {
  readonly globals: Record<string, unknown> = {}
  private readonly handles = new Map<Entity, Handle>()
  private readonly byName = new Map<string, Entity[]>()
  private readonly children = new Map<Entity, Entity[]>()
  private readonly hud: HudApi = {
    set: (key, value) => hudStore.set((s) => ({ values: { ...s.values, [key]: value } })),
    remove: (key) =>
      hudStore.set((s) => {
        const { [key]: _removed, ...values } = s.values
        return { values }
      }),
    message: (text) => hudStore.set({ message: text }),
  }

  constructor(
    private readonly engine: Engine,
    private readonly doc: ProjectDoc,
  ) {
    hudStore.set({ values: {}, message: null })
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
          }
        },
      },
      { name: 'scripts.update', phase: 'update', run: run('update') },
      { name: 'scripts.lateUpdate', phase: 'late', run: run('lateUpdate') },
    ]
  }

  private context(handle: Handle, behavior: Behavior, overrides: Record<string, ParamValue>): ScriptContext {
    const params: Record<string, ParamValue> = {}
    for (const key in behavior.params) params[key] = key in overrides ? overrides[key] : behavior.params[key]
    const prefix = `[${handle.name}]`
    return {
      ...handle,
      params,
      engine: this.engine,
      input: this.engine.input,
      time: this.engine.time,
      state: {},
      globals: this.globals,
      hud: this.hud,
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
