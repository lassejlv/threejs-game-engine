// @vitest-environment jsdom
import { type AudioListener, Object3D, PerspectiveCamera, Scene } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Engine, type Entity, EventBus, type RapierPhysics, type System, World } from '../../engine'
import { type LogLevel, logListeners } from '../console'
import { createEntity, emptyProject, type ParamValue, type ProjectDoc } from '../document'
import type { Handle } from '../scripting'
import type { AssetResolver } from './nodes'
import { activeSessions, PlaySession, type SessionRuntime } from './playSession'

// PlaySession only touches a handful of Engine members, so a fake engine with a
// real World and EventBus is enough (the real Engine needs WebGL).
function fakeEngine() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return {
    world: new World(),
    events: new EventBus<{ collisionEnter: { a: Entity; b: Entity }; collisionExit: { a: Entity; b: Entity } }>(),
    container,
    camera: new PerspectiveCamera(),
    scene: new Scene(),
    input: {},
    time: { elapsed: 0, delta: 0 },
    assets: { audio: () => Promise.reject(new Error('no audio in tests')) },
  } as unknown as Engine
}

function fakeRapier() {
  return {
    raycast: vi.fn(() => null),
    applyImpulse: vi.fn(),
  }
}

const noAssets: AssetResolver = { byName: () => null, url: () => null } as unknown as AssetResolver

let sourceCounter = 0
/** compileScript caches by source text, so every script gets a unique marker. */
function unique(source: string): string {
  return `${source}\n// test script ${sourceCounter++}`
}

interface Setup {
  engine: Engine
  session: PlaySession
  rapier: ReturnType<typeof fakeRapier>
  runtime: SessionRuntime & { loadScene: ReturnType<typeof vi.fn> }
  doc: ProjectDoc
  systems: System[]
  logs: { level: LogLevel; message: string }[]
  /** Adds a project script; returns its id. */
  script(name: string, source: string): string
  /** Creates and registers an entity with the given scripts. */
  entity(name: string, scripts?: { script: string; params?: Record<string, ParamValue> }[], parent?: Handle): Handle
  run(name: 'scripts.fixedUpdate' | 'scripts.update' | 'scripts.lateUpdate' | 'scripts.sceneSwitch', dt?: number): void
  frame(dt?: number): void
  calls: string[]
  dispose(): void
}

const cleanups: (() => void)[] = []

function setup(): Setup {
  const engine = fakeEngine()
  const doc = emptyProject()
  const rapier = fakeRapier()
  const listener = new Object3D() as unknown as AudioListener
  const session = new PlaySession(engine, doc, rapier as unknown as RapierPhysics, listener, noAssets)
  const runtime = {
    sceneName: 'Main',
    spawn: vi.fn(() => undefined),
    loadScene: vi.fn(),
  }
  session.connect(runtime)
  const systems = session.systems()
  const teardown = systems[0].init?.(engine)
  const logs: Setup['logs'] = []
  const onLog = (level: LogLevel, message: string) => logs.push({ level, message })
  logListeners.add(onLog)
  const calls: string[] = []
  session.globals.calls = calls

  const get = (name: string) => {
    const system = systems.find((s) => s.name === name)
    if (!system) throw new Error(`no system ${name}`)
    return system
  }

  const s: Setup = {
    engine,
    session,
    rapier,
    runtime,
    doc,
    systems,
    logs,
    calls,
    script(name, source) {
      const id = `script-${name}-${sourceCounter}`
      doc.scripts.push({ id, name, source: unique(source) })
      return id
    },
    entity(name, scripts = [], parent) {
      const entity = engine.world.create()
      const object = new Object3D()
      object.name = name
      const handle: Handle = { entity, name, object, body: undefined }
      session.register(handle, parent ? parent.entity : null)
      session.attachScripts(
        handle,
        createEntity(name, { scripts: scripts.map((ref) => ({ script: ref.script, params: ref.params ?? {} })) }),
      )
      return handle
    },
    run(name, dt = 1 / 60) {
      get(name).run(engine, dt)
    },
    frame(dt = 1 / 60) {
      s.run('scripts.fixedUpdate', dt)
      s.run('scripts.update', dt)
      s.run('scripts.lateUpdate', dt)
      s.run('scripts.sceneSwitch', dt)
    },
    dispose() {
      logListeners.delete(onLog)
      if (typeof teardown === 'function') teardown()
    },
  }
  cleanups.push(() => s.dispose())
  return s
}

/** A script that records every lifecycle call as `<entity>.<hook>`. */
const RECORDER = `export default {
  start(ctx) { ctx.globals.calls.push(ctx.name + '.start') },
  fixedUpdate(ctx) { ctx.globals.calls.push(ctx.name + '.fixedUpdate') },
  update(ctx) { ctx.globals.calls.push(ctx.name + '.update') },
  lateUpdate(ctx) { ctx.globals.calls.push(ctx.name + '.lateUpdate') },
  onCollisionEnter(ctx, other) { ctx.globals.calls.push(ctx.name + '.enter:' + other.name) },
  onCollisionExit(ctx, other) { ctx.globals.calls.push(ctx.name + '.exit:' + other.name) },
  onDestroy(ctx) { ctx.globals.calls.push(ctx.name + '.destroy') },
}`

beforeEach(() => {
  sourceCounter++
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ''
})

describe('PlaySession', () => {
  it('registers itself as active while its systems are initialized', () => {
    const s = setup()
    expect(activeSessions.has(s.session)).toBe(true)
    s.dispose()
    expect(activeSessions.has(s.session)).toBe(false)
  })

  it('runs start before the first update, then fixedUpdate/update/lateUpdate in phase order', () => {
    const s = setup()
    const id = s.script('Recorder', RECORDER)
    s.entity('A', [{ script: id }])
    expect(s.calls).toEqual([]) // nothing runs until a system does

    s.frame()
    expect(s.calls).toEqual(['A.start', 'A.fixedUpdate', 'A.update', 'A.lateUpdate'])

    s.calls.length = 0
    s.frame()
    expect(s.calls).toEqual(['A.fixedUpdate', 'A.update', 'A.lateUpdate']) // start runs once
  })

  it('starts a script lazily in whichever phase runs first', () => {
    const s = setup()
    const id = s.script('Recorder', RECORDER)
    s.entity('A', [{ script: id }])
    s.run('scripts.update')
    expect(s.calls).toEqual(['A.start', 'A.update'])
  })

  it('passes dt and resolves params from defaults and inspector overrides', () => {
    const s = setup()
    const id = s.script(
      'Params',
      `export default {
        params: { speed: 3, label: 'x' },
        update(ctx, dt) { ctx.globals.calls.push(ctx.name + ':' + ctx.params.speed + ':' + ctx.params.label + ':' + dt) },
      }`,
    )
    s.entity('A', [{ script: id }])
    s.entity('B', [{ script: id, params: { speed: 9 } }])
    s.run('scripts.update', 0.5)
    expect(s.calls).toEqual(['A:3:x:0.5', 'B:9:x:0.5'])
  })

  it('runs built-in scripts', () => {
    const s = setup()
    const handle = s.entity('Spinner', [{ script: 'builtin:Rotate', params: { y: 180 } }])
    s.run('scripts.update', 1)
    expect(handle.object.rotation.y).toBeCloseTo(Math.PI)
  })

  it('disables and logs a throwing script while other scripts keep running', () => {
    const s = setup()
    const bad = s.script(
      'Bad',
      `export default {
        update(ctx) {
          ctx.globals.calls.push('bad')
          throw new Error('boom')
        },
      }`,
    )
    const good = s.script('Recorder', RECORDER)
    s.entity('Broken', [{ script: bad }, { script: good }])
    s.entity('Fine', [{ script: good }])

    s.run('scripts.update')
    s.run('scripts.update')
    s.run('scripts.update')

    // The throwing script ran exactly once; its sibling and the other entity kept going.
    expect(s.calls.filter((c) => c === 'bad')).toHaveLength(1)
    expect(s.calls.filter((c) => c === 'Broken.update')).toHaveLength(3)
    expect(s.calls.filter((c) => c === 'Fine.update')).toHaveLength(3)

    const errors = s.logs.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Bad on "Broken" threw and was disabled')
    expect(errors[0].message).toContain('boom')
  })

  it('disables a script whose start throws without running its update', () => {
    const s = setup()
    const id = s.script(
      'BadStart',
      `export default {
        start() { throw new Error('nope') },
        update(ctx) { ctx.globals.calls.push('update') },
      }`,
    )
    s.entity('A', [{ script: id }])
    s.frame()
    s.frame()
    expect(s.calls).toEqual([])
    expect(s.logs.some((l) => l.level === 'error' && l.message.includes('nope'))).toBe(true)
  })

  it('logs a compile error and skips the script', () => {
    const s = setup()
    const id = s.script('Syntax', 'export default { update( {')
    const handle = s.entity('A', [{ script: id }])
    expect(s.logs.some((l) => l.level === 'error' && l.message.includes('"A": script failed to compile'))).toBe(true)
    expect(() => s.frame()).not.toThrow()
    expect(handle.name).toBe('A')
  })

  it('finds entities by name and skips destroyed ones', () => {
    const s = setup()
    const finder = s.script(
      'Finder',
      `export default {
        update(ctx) {
          const target = ctx.find('Target')
          ctx.globals.found = target ? target.entity : null
          ctx.globals.missing = ctx.find('Nobody')
        },
      }`,
    )
    const target = s.entity('Target')
    s.entity('Seeker', [{ script: finder }])
    s.run('scripts.update')
    expect(s.session.globals.found).toBe(target.entity)
    expect(s.session.globals.missing).toBeUndefined()

    // A second entity with the same name takes over once the first is gone.
    const second = s.entity('Target')
    s.engine.world.destroy(target.entity)
    s.run('scripts.update')
    expect(s.session.globals.found).toBe(second.entity)

    s.engine.world.destroy(second.entity)
    s.run('scripts.update')
    expect(s.session.globals.found).toBeNull()
  })

  it('destroy runs onDestroy and destroys children recursively', () => {
    const s = setup()
    const recorder = s.script('Recorder', RECORDER)
    const killer = s.script(
      'Killer',
      `export default {
        update(ctx) {
          if (ctx.globals.kill) { ctx.destroy(ctx.find('Root')); ctx.globals.kill = false }
        },
      }`,
    )
    const root = s.entity('Root', [{ script: recorder }])
    const child = s.entity('Child', [{ script: recorder }], root)
    const grandchild = s.entity('Grandchild', [{ script: recorder }], child)
    const bystander = s.entity('Bystander', [{ script: recorder }])
    s.entity('Killer', [{ script: killer }])

    s.run('scripts.update') // start everything
    s.calls.length = 0
    s.session.globals.kill = true
    s.run('scripts.update')

    const destroyed = s.calls.filter((c) => c.endsWith('.destroy'))
    // Children go first (depth-first), then the root.
    expect(destroyed).toEqual(['Grandchild.destroy', 'Child.destroy', 'Root.destroy'])
    const { world } = s.engine
    expect(world.isAlive(root.entity)).toBe(false)
    expect(world.isAlive(child.entity)).toBe(false)
    expect(world.isAlive(grandchild.entity)).toBe(false)
    expect(world.isAlive(bystander.entity)).toBe(true)

    s.calls.length = 0
    s.run('scripts.update')
    expect(s.calls).toEqual(['Bystander.update'])
  })

  it('does not call onDestroy for a script that never started', () => {
    const s = setup()
    const recorder = s.script('Recorder', RECORDER)
    const killer = s.script(
      'Killer',
      `export default { start(ctx) { ctx.destroy(ctx.find('Victim')) } }`,
    )
    // Killer runs first (registered first), so Victim never gets to start.
    s.entity('Killer', [{ script: killer }])
    const victim = s.entity('Victim', [{ script: recorder }])
    s.run('scripts.update')
    expect(s.calls).toEqual([])
    expect(s.engine.world.isAlive(victim.entity)).toBe(false)
  })

  it('ctx.destroy() with no argument destroys the calling entity', () => {
    const s = setup()
    const id = s.script('SelfDestruct', `export default { update(ctx) { ctx.destroy() } }`)
    const handle = s.entity('A', [{ script: id }])
    s.run('scripts.update')
    expect(s.engine.world.isAlive(handle.entity)).toBe(false)
  })

  it('dispatches collision events to both sides', () => {
    const s = setup()
    const recorder = s.script('Recorder', RECORDER)
    const a = s.entity('A', [{ script: recorder }])
    const b = s.entity('B', [{ script: recorder }])
    const plain = s.entity('Wall')

    s.engine.events.emit('collisionEnter', { a: a.entity, b: b.entity })
    // Collision hooks start the script first if it hasn't run yet.
    expect(s.calls).toEqual(['A.start', 'A.enter:B', 'B.start', 'B.enter:A'])

    s.calls.length = 0
    s.engine.events.emit('collisionExit', { a: b.entity, b: a.entity })
    expect(s.calls).toEqual(['B.exit:A', 'A.exit:B'])

    // An entity without scripts is still reported to the other side.
    s.calls.length = 0
    s.engine.events.emit('collisionEnter', { a: plain.entity, b: a.entity })
    expect(s.calls).toEqual(['A.enter:Wall'])
  })

  it('ignores collisions after the session is torn down', () => {
    const s = setup()
    const recorder = s.script('Recorder', RECORDER)
    const a = s.entity('A', [{ script: recorder }])
    const b = s.entity('B', [{ script: recorder }])
    s.dispose()
    s.engine.events.emit('collisionEnter', { a: a.entity, b: b.entity })
    expect(s.calls).toEqual([])
  })

  it('hot-reloads a script, keeping per-instance state and overrides', () => {
    const s = setup()
    const id = s.script(
      'Counter',
      `export default {
        params: { step: 1 },
        start(ctx) { ctx.state.count = 0 },
        update(ctx) {
          ctx.state.count += ctx.params.step
          ctx.globals.calls.push(ctx.name + ':v1:' + ctx.state.count)
        },
      }`,
    )
    s.entity('A', [{ script: id }])
    s.entity('B', [{ script: id, params: { bonus: 100 } }])
    s.run('scripts.update')
    s.run('scripts.update')
    expect(s.calls).toEqual(['A:v1:1', 'B:v1:1', 'A:v1:2', 'B:v1:2'])

    s.calls.length = 0
    s.session.reloadScript(
      id,
      'Counter',
      unique(`export default {
        params: { step: 1, bonus: 10 },
        start(ctx) { ctx.state.count = 0 },
        update(ctx) {
          ctx.state.count += ctx.params.step + ctx.params.bonus
          ctx.globals.calls.push(ctx.name + ':v2:' + ctx.state.count)
        },
      }`),
    )
    s.run('scripts.update')
    // start does not run again; state survives; the new param picks up the default or the override.
    expect(s.calls).toEqual(['A:v2:13', 'B:v2:103'])
    expect(s.logs.some((l) => l.message === 'Hot-reloaded Counter (2 instances)')).toBe(true)
  })

  it('re-enables a failed script when it is hot-reloaded', () => {
    const s = setup()
    const id = s.script('Flaky', `export default { update() { throw new Error('v1 broken') } }`)
    s.entity('A', [{ script: id }])
    s.run('scripts.update')
    s.session.reloadScript(id, 'Flaky', unique(`export default { update(ctx) { ctx.globals.calls.push('fixed') } }`))
    s.run('scripts.update')
    expect(s.calls).toEqual(['fixed'])
  })

  it('keeps the running version when a hot-reload fails to compile', () => {
    const s = setup()
    const id = s.script('Stable', `export default { update(ctx) { ctx.globals.calls.push('v1') } }`)
    s.entity('A', [{ script: id }])
    s.session.reloadScript(id, 'Stable', unique('export default { update( {'))
    s.run('scripts.update')
    expect(s.calls).toEqual(['v1'])
    expect(s.logs.some((l) => l.level === 'error' && l.message.includes('compile error, keeping the running version'))).toBe(
      true,
    )
  })

  it('defers loadScene until the sceneSwitch system runs', () => {
    const s = setup()
    const id = s.script(
      'Portal',
      `export default {
        update(ctx) {
          if (!ctx.state.done) { ctx.loadScene('Level 2'); ctx.state.done = true }
          ctx.globals.calls.push('after loadScene:' + ctx.sceneName)
        },
        lateUpdate(ctx) { ctx.globals.calls.push('late') },
      }`,
    )
    s.entity('A', [{ script: id }])
    s.run('scripts.fixedUpdate')
    s.run('scripts.update')
    s.run('scripts.lateUpdate')
    expect(s.runtime.loadScene).not.toHaveBeenCalled()
    expect(s.calls).toEqual(['after loadScene:Main', 'late'])

    s.run('scripts.sceneSwitch')
    expect(s.runtime.loadScene).toHaveBeenCalledTimes(1)
    expect(s.runtime.loadScene).toHaveBeenCalledWith('Level 2')

    // The request is consumed once.
    s.run('scripts.sceneSwitch')
    expect(s.runtime.loadScene).toHaveBeenCalledTimes(1)
  })

  it('forwards spawn to the runtime and physics calls to Rapier', () => {
    const s = setup()
    const id = s.script(
      'Physics',
      `export default {
        update(ctx) {
          ctx.spawn('Coin', { position: { x: 1, y: 2, z: 3 } })
          ctx.globals.hit = ctx.physics.raycast(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 5)
          ctx.physics.applyImpulse(ctx, new THREE.Vector3(0, 1, 0))
        },
      }`,
    )
    const handle = s.entity('A', [{ script: id }])
    s.run('scripts.update')
    expect(s.runtime.spawn).toHaveBeenCalledWith('Coin', { position: { x: 1, y: 2, z: 3 } })
    expect(s.rapier.raycast).toHaveBeenCalledTimes(1)
    // The caster is excluded from its own raycasts by default.
    expect((s.rapier.raycast.mock.calls[0] as unknown[])[3]).toMatchObject({ exclude: handle.entity })
    expect(s.session.globals.hit).toBeNull()
    expect(s.rapier.applyImpulse).toHaveBeenCalledWith(handle.entity, expect.objectContaining({ y: 1 }))
  })

  it('writes HUD values into the container and removes the UI on teardown', () => {
    const s = setup()
    const id = s.script('Hud', `export default { start(ctx) { ctx.hud.set('Coins', '1 / 32') } }`)
    s.entity('A', [{ script: id }])
    s.frame()
    const container = s.engine.container
    expect(container.textContent).toContain('1 / 32')
    s.dispose()
    expect(container.textContent).not.toContain('1 / 32')
  })
})
