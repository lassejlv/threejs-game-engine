import {
  type ColorRepresentation,
  NeutralToneMapping,
  type Object3D,
  PCFShadowMap,
  type OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { Assets } from '../assets/Assets'
import { Transform } from '../components'
import type { Entity } from '../ecs/component'
import { World } from '../ecs/World'
import { Input } from '../input/Input'
import { createCollisionSystem, createInterpolationSystem, createPhysicsSystem } from '../physics/systems'
import { disposeObject } from '../utils/dispose'
import { EventBus } from './EventBus'
import type { GameScene } from './GameScene'
import { createStore } from './Store'
import { PHASES, type Phase, type System } from './System'
import { Time } from './Time'

export interface EngineOptions {
  /** Element the canvas is created in. The canvas always fills it. */
  container: HTMLElement
  /** Default: on for low-DPI screens, off for high-DPI (where it is costly and barely visible). */
  antialias?: boolean
  /** Caps devicePixelRatio. Default 2. */
  maxPixelRatio?: number
  /** Simulation step in seconds. Default 1/60. */
  fixedTimestep?: number
  /** Max fixed steps per frame before dropping time (avoids the spiral of death). Default 6. */
  maxSubSteps?: number
  /** Longest frame delta accepted, in seconds. Default 0.1. */
  maxDelta?: number
  shadows?: boolean
  background?: ColorRepresentation
  powerPreference?: WebGLPowerPreference
  /** Register built-in physics, collision and interpolation systems per scene. Default true. */
  physics?: boolean
}

export interface CollisionEvent {
  a: Entity
  b: Entity
}

export interface EngineEvents {
  collisionEnter: CollisionEvent
  collisionExit: CollisionEvent
  sceneLoaded: { name: string }
  resize: { width: number; height: number }
  error: { error: unknown }
  dispose: Record<string, never>
}

export interface SystemTiming {
  name: string
  phase: Phase
  ms: number
}

export interface EngineStats {
  fps: number
  /** CPU time per frame (systems + render submission). */
  frameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  entities: number
  paused: boolean
  /** Populated while `engine.profiling` is on. */
  systems: SystemTiming[]
}

interface SystemEntry {
  system: System
  phase: Phase
  order: number
  persistent: boolean
  cleanup?: () => void
  ms: number
}

const STATS_INTERVAL = 250

/** The camera the engine renders with. Orthographic cameras keep `userData.orthoSize` (half the view height in meters). */
export type GameCamera = PerspectiveCamera | OrthographicCamera

/** Matches a camera's projection to a viewport aspect ratio. */
export function fitCamera(camera: GameCamera, aspect: number): void {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera
    const size = (ortho.userData.orthoSize as number | undefined) ?? 5
    ortho.left = -size * aspect
    ortho.right = size * aspect
    ortho.top = size
    ortho.bottom = -size
  } else (camera as PerspectiveCamera).aspect = aspect
  camera.updateProjectionMatrix()
}

/** Replaces the plain `renderer.render` call, e.g. with a post-processing chain. */
export interface RenderPipeline {
  render(scene: Scene, camera: GameCamera, dt: number): void
  /** CSS size and pixel ratio of the canvas. */
  setSize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

export class Engine {
  readonly renderer: WebGLRenderer
  readonly canvas: HTMLCanvasElement
  readonly container: HTMLElement
  readonly scene = new Scene()
  readonly world = new World()
  readonly time: Time
  readonly input = new Input()
  readonly assets = new Assets()
  readonly events = new EventBus<EngineEvents>()
  readonly stats = createStore<EngineStats>({
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, entities: 0, paused: false, systems: [],
  })
  readonly physics = { gravity: new Vector3(0, -25, 0) }

  /** Measure per-system timings (small overhead). */
  profiling = false

  private _camera: GameCamera
  private _paused = false
  private stepRequested = false
  private running = false
  private disposed = false
  private lastTime = -1
  private accumulator = 0
  private readonly maxSubSteps: number
  private readonly maxDelta: number
  private readonly maxPixelRatio: number
  private readonly builtinPhysics: boolean
  private readonly systems: Record<Phase, SystemEntry[]> = { fixed: [], update: [], late: [], render: [] }
  private readonly resizeObserver: ResizeObserver
  private currentScene: GameScene | null = null
  private _pipeline: RenderPipeline | null = null
  private sceneAbort: AbortController | null = null
  private statFrames = 0
  private statCpu = 0
  private statStart = 0

  constructor(options: EngineOptions) {
    this.container = options.container
    this.time = new Time(options.fixedTimestep ?? 1 / 60)
    this.maxSubSteps = options.maxSubSteps ?? 6
    this.maxDelta = options.maxDelta ?? 0.1
    this.maxPixelRatio = options.maxPixelRatio ?? 2
    this.builtinPhysics = options.physics ?? true

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
    this.canvas.tabIndex = 0
    this.container.appendChild(this.canvas)

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: options.antialias ?? window.devicePixelRatio < 2,
      powerPreference: options.powerPreference ?? 'high-performance',
    })
    this.renderer.toneMapping = NeutralToneMapping
    // Reset once per frame, so stats count every pass of a multi-pass pipeline.
    this.renderer.info.autoReset = false
    this.renderer.shadowMap.enabled = options.shadows ?? true
    this.renderer.shadowMap.type = PCFShadowMap
    if (options.background !== undefined) this.renderer.setClearColor(options.background)

    this._camera = new PerspectiveCamera(60, 1, 0.1, 1000)
    this.input.attach(this.canvas)

    // Entities with a Transform live in the scene graph.
    this.world.onAdd(Transform, (entity, object) => {
      object.userData.entity = entity
      if (!object.parent) this.scene.add(object)
    })
    this.world.onRemove(Transform, (_entity, object) => {
      object.removeFromParent()
      delete object.userData.entity
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
  }

  /** Custom render path (post-processing). Setting a new one disposes the old one. */
  get pipeline(): RenderPipeline | null {
    return this._pipeline
  }

  set pipeline(pipeline: RenderPipeline | null) {
    if (pipeline === this._pipeline) return
    this._pipeline?.dispose()
    this._pipeline = pipeline
    this.resize()
  }

  get camera(): GameCamera {
    return this._camera
  }

  set camera(camera: GameCamera) {
    this._camera = camera
    this.resize()
  }

  get paused(): boolean {
    return this._paused
  }

  get activeScene(): GameScene | null {
    return this.currentScene
  }

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.lastTime = -1
    this.renderer.setAnimationLoop(this.tick)
  }

  stop(): void {
    this.running = false
    this.renderer.setAnimationLoop(null)
  }

  pause(): void {
    this._paused = true
    this.stats.set({ paused: true })
  }

  resume(): void {
    this._paused = false
    this.input.endFixedStep()
    this.stats.set({ paused: false })
  }

  /** While paused, advance exactly one fixed step on the next frame. */
  step(): void {
    this.stepRequested = true
  }

  /** Creates an entity, optionally with a Transform. */
  spawn(object?: Object3D): Entity {
    const entity = this.world.create()
    if (object) this.world.add(entity, Transform, object)
    return entity
  }

  /**
   * Registers a system. Scene systems are removed when the scene unloads;
   * pass `persistent: true` to keep one across scenes. Returns a remover.
   */
  addSystem(system: System, { persistent = false } = {}): () => void {
    const entry: SystemEntry = {
      system,
      phase: system.phase ?? 'update',
      order: system.order ?? 0,
      persistent,
      ms: 0,
    }
    const list = [...this.systems[entry.phase], entry]
    // Stable sort keeps registration order for equal `order`.
    list.sort((a, b) => a.order - b.order)
    this.systems[entry.phase] = list // copy-on-write: safe during iteration
    entry.cleanup = system.init?.(this) ?? undefined
    return () => this.removeEntry(entry)
  }

  removeSystem(system: System): void {
    for (const phase of PHASES) {
      const entry = this.systems[phase].find((e) => e.system === system)
      if (entry) this.removeEntry(entry)
    }
  }

  /** Unloads the current scene (entities, scene systems, scene graph) and sets up the next one. */
  async loadScene(scene: GameScene): Promise<void> {
    this.sceneAbort?.abort()
    const abort = new AbortController()
    this.sceneAbort = abort
    this.unloadScene()
    this.currentScene = scene
    if (this.builtinPhysics && scene.physics !== false) {
      this.addSystem(createPhysicsSystem())
      this.addSystem(createCollisionSystem())
      this.addSystem(createInterpolationSystem())
    }
    try {
      await scene.setup({ engine: this, signal: abort.signal })
    } catch (error) {
      if (abort.signal.aborted) return
      throw error
    }
    if (abort.signal.aborted) return
    this.world.flush()
    this.events.emit('sceneLoaded', { name: scene.name })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.sceneAbort?.abort()
    this.unloadScene()
    for (const phase of PHASES) for (const entry of [...this.systems[phase]]) this.removeEntry(entry)
    this.resizeObserver.disconnect()
    this.pipeline = null
    this.input.detach()
    this.events.emit('dispose', {})
    this.events.clear()
    void this.assets.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }

  private unloadScene(): void {
    if (!this.currentScene) return
    this.currentScene.teardown?.(this)
    for (const phase of PHASES) {
      for (const entry of this.systems[phase]) if (!entry.persistent) this.removeEntry(entry)
    }
    disposeObject(this.scene)
    this.world.clear()
    this.scene.clear()
    this.scene.background = null
    this.scene.environment = null
    this.scene.fog = null
    this.accumulator = 0
    this.currentScene = null
  }

  private removeEntry(entry: SystemEntry): void {
    const list = this.systems[entry.phase]
    if (!list.includes(entry)) return
    this.systems[entry.phase] = list.filter((e) => e !== entry)
    entry.cleanup?.()
  }

  private readonly tick = (now: number): void => {
    try {
      this.frame(now)
    } catch (error) {
      // Pause instead of spamming the same exception every frame.
      console.error('[engine] frame error, pausing', error)
      this.pause()
      this.events.emit('error', { error })
    }
  }

  private frame(now: number): void {
    const cpuStart = performance.now()
    const time = this.time
    const dt = this.lastTime < 0 ? 0 : Math.min((now - this.lastTime) / 1000, this.maxDelta)
    this.lastTime = now
    this.input.poll()

    const stepping = this._paused && this.stepRequested
    this.stepRequested = false
    if (!this._paused || stepping) {
      const scaled = stepping ? time.fixedDelta : dt * time.scale
      time.delta = scaled
      time.elapsed += scaled
      this.accumulator += scaled

      this.input.phase = 'fixed'
      let steps = 0
      while (this.accumulator >= time.fixedDelta) {
        if (steps === this.maxSubSteps) {
          this.accumulator = 0
          break
        }
        this.runPhase('fixed', time.fixedDelta)
        this.input.endFixedStep()
        this.accumulator -= time.fixedDelta
        time.fixedFrame++
        steps++
      }
      this.input.phase = 'frame'
      time.alpha = this.accumulator / time.fixedDelta

      this.runPhase('update', scaled)
      this.runPhase('late', scaled)
    } else {
      time.delta = 0
    }

    this.runPhase('render', time.delta)
    this.renderer.info.reset()
    if (this._pipeline) this._pipeline.render(this.scene, this._camera, time.delta)
    else this.renderer.render(this.scene, this._camera)
    this.input.endFrame()
    time.frame++
    this.collectStats(now, performance.now() - cpuStart)
  }

  private runPhase(phase: Phase, dt: number): void {
    const list = this.systems[phase]
    if (this.profiling) {
      for (const entry of list) {
        const t = performance.now()
        entry.system.run(this, dt)
        entry.ms += (performance.now() - t - entry.ms) * 0.1
      }
    } else {
      for (const entry of list) entry.system.run(this, dt)
    }
    this.world.flush()
  }

  private collectStats(now: number, cpuMs: number): void {
    this.statFrames++
    this.statCpu += cpuMs
    if (this.statStart === 0) this.statStart = now
    const elapsed = now - this.statStart
    if (elapsed < STATS_INTERVAL) return

    const info = this.renderer.info
    const systems: SystemTiming[] = []
    if (this.profiling) {
      for (const phase of PHASES) {
        for (const entry of this.systems[phase]) systems.push({ name: entry.system.name, phase, ms: entry.ms })
      }
    }
    this.stats.set({
      fps: Math.round((this.statFrames * 1000) / elapsed),
      frameMs: this.statCpu / this.statFrames,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      entities: this.world.entityCount,
      systems,
    })
    this.statFrames = 0
    this.statCpu = 0
    this.statStart = now
  }

  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    const pixelRatio = Math.min(window.devicePixelRatio, this.maxPixelRatio)
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    this._pipeline?.setSize(width, height, pixelRatio)
    fitCamera(this._camera, width / height)
    this.events.emit('resize', { width, height })
  }
}
